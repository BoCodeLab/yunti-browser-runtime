# 合并 BrowserSkill 与 Yunti：面向"更快、更稳"的方案

- 文档状态：方案稿；P1 的队列切片与 `wait_for` 订阅切片已实现并通过测试（2026-09-19），其余阶段待实施
- 日期：2026-09-19
- 对比对象：
  - Yunti Browser Runtime 0.2.7（本仓库工作区，含 3 个未提交文件）
  - Tencent BrowserSkill `fa953dc6fcd868827b93164e3bea26198e691224`（MIT，与本项目许可证兼容）
- 证据等级：
  - Yunti 实测数据来自仓库内 benchmark / soak 产物（见 `PROJECT_STATUS.md`），可复核
  - BrowserSkill 结论来自其源码与文档；其仓库未发布延迟基准，本次未运行它的评测
  - 标注"待验证"的结论必须在同一台机器上用同一套 harness 复测后才能作为决策依据

## 0. 结论

1. **合并代码不会自动变快。** 当前 Yunti 单次 MCP 工具调用 p50 只有 4–9 ms、hub 单跳 mean 0.066 ms / p95 0.117 ms，传输与桥接不是主要瓶颈；真正的慢点在观察体量（合成样本一次完整 observe 可达 115 KB / 29k token）、任务级往返次数、全局单队列串行和尾部恢复事件。
2. **合并的意义应该定在"机制合并"：把 BrowserSkill 的常驻 WebSocket、每会话队列、类型化帧、effect_state、重连退避、会话身份这些稳定性机制搬进 Yunti**，而不是先重写内核。
3. 推荐顺序：先做方案 A（机制吸收，6–9 周可见指标收益）→ 用统一基准验证 → 再决定是否进入方案 B（统一内核、单仓库、MCP+CLI 双入口）。
4. 不建议方案 C（双运行时共享协议）：两个 daemon 争抢同一个扩展、双 owner 检测、版本矩阵会指数级变复杂，收益最小。
5. 合并后必须保持两条底线：**写操作一次派发、绝不盲目重放；agent 侧永远不需要理解内部 session 的替换。**

## 1. 速度瓶颈到底在哪

### 1.1 Yunti 已有实测数据（0.2.6/0.2.7）

| 场景 | 结果 | 关键延迟 |
| --- | --- | --- |
| P8 完整基准（38 场景 / 114 次尝试 / 397 次 MCP 调用） | 38/38 通过，重复写入 0 | attempt p50/p95/max = 520/1501/1523 ms；tool-call p50/p95/max = 9/435/1406 ms |
| 15 分钟 Edge soak（840 轮 / 22410 次调用 / 52 个工具全覆盖） | 22410/22410 成功，重复写入 0 | call p50/p95/p99/max = 4/213/413/956 ms |
| 同一 0.2.6 树的主机过载诊断（负载 115） | 功能全绿，仅延迟超标 | call p50/p95/p99/max = 5/321/682/25122 ms，官方保留为功能证据，不作延迟基线 |

结论性事实：

- **传输不是瓶颈**：tool-call p50 4–9 ms 已经很低，环回 HTTP 本身不构成问题。
- **任务级开销才是大头**：一次 attempt 的 p50 是 520 ms，约等于"观察 → 行动 → 验证"多次工具调用的总和，说明成本在往返次数与观察体量，而不在单跳。
- **恢复事件是尾延迟的主要嫌疑**：15 分钟里出现 840 次 stale-route 恢复、211 次 CDP 重挂、281 个子标签页创建；这些路径带有固定等待，但当前缺少正常调用与恢复调用的分段计时，尚不能把 p95 213–435 ms 直接归因于它们，需要在 P0 用埋点验证。
- **主机负载会污染尾延迟**：负载 115 时出现 25 s 的 max，任何"合并后更快"的结论必须在受控负载下测量。

#### 本次补充的只读微基准（2026-09-19，当前工作区）

| 测量 | 方法 | 结果 |
| --- | --- | --- |
| Hub 控制面往返 | 模拟 controller 常驻轮询，500 次工具路由调用（MCP → hub → 取件 → 结果回填） | mean 0.066 ms；p50 0.059 ms；p95 0.117 ms；p99 0.199 ms；max 0.442 ms |
| 典型完整 observe 负载（合成） | 200 个交互元素 + 12,000 字符 textTree + 50 个滚动容器，字段按当前 `dom-observer` 输出构造 | 115,311 bytes ≈ 28,828 token（按仓库 /4 估算）；JSON 序列化 0.84 ms |
| 紧凑 observe 负载（合成） | 60 个交互元素 + 最小字段 + token 预算标记 | 6,840 bytes ≈ 1,710 token；缩小约 16.9 倍 |

结论：

- 控制器与桥接的单跳开销是微秒级。**把 Node 换成 Rust 不会解决 Agent 感知的速度问题。**
- 真正进入模型上下文的是观察结果。按当前默认上限，一次完整 observe 的合成样本可达约 29k token；典型任务若在每个动作前后都做完整观察，观察内容会迅速累积到十万 token 量级。
- 上表 payload 是合成样本，不是真实页面实测；真实 p50/p95 必须由 P0 基准在 fixture 上产出。但它足以确定方向：**先砍观察体量与往返次数，再谈传输层重写。**

### 1.2 Yunti 当前热路径（读代码确认）

```text
Agent → MCP stdio → mcp/server.js → 环回 HTTP → bridge-hub（内存队列）
      → 扩展 GET /extension/poll 长轮询（timeoutMs=25000）取走 tool_request
      → session-manager 的 controllerToolQueue 串行执行
      → tool-handlers → content script 或 chrome.debugger(CDP)
      → POST /extension/result → hub 解析 → MCP 返回
```

关键常量与结构（`mcp/bridge-hub.js`、`extension/session-manager.js`）：

| 项 | 当前值 | 影响 |
| --- | --- | --- |
| 工具超时 | 30 s（MCP 侧）/ 25 s（扩展侧） | 超时后结果不确定性需要 agent 处理 |
| 扩展长轮询 | 25 s 长轮询 + 出错退避 1500 ms | 断开窗口内请求排空延迟 |
| controller 心跳 | 每轮重新 `chrome.tabs.query({})` 并 POST `/sessions/register` | 每轮多一次浏览器查询 + 一次 HTTP 往返 |
| 执行队列 | 单个 controller promise 链（`controllerToolQueue`）串行 | 所有浏览器工具全局串行，多 agent/多标签页互相排队 |
| content script 探测 | 1500 ms 超时；注入 3000 ms | 恢复路径最贵的等待之一 |
| 睡眠标签页唤醒 | `tabs.update(active)` + 150 ms 固定等待 + 注入 | 固定延迟不可压缩 |
| 注入后注册等待 | 最多 10 × 25 ms | 每次恢复最多 250 ms 空转 |
| 协议版本 | 全等匹配，不匹配直接失败（retryBudget=0） | 稳定但脆弱：升级不同步即不可用 |

结构性问题按影响排序：

1. 单 controller 单 promise 链：任何工具（含只读诊断）都要排队，不同标签页之间也会互相阻塞。
2. `yunti_wait_for` 在队列内执行且强制挂 CDP：`extension/tool-handlers.js` 先 `ensureCdpAttached`，再每 200 ms 通过 `Runtime.evaluate` 轮询，最长 30 s；该调用占用 `controllerToolQueue`，因此同一浏览器内其它标签页的 click / fill / observe 最多会被阻塞 30 s。这是当前"一个等待拖慢所有页面"的直接原因，也是 P1 必须先修的单点。
3. 长轮询空窗：poll 断开到下一次 poll 建立之间的请求只能排队等待。
4. 每轮心跳的额外往返与 `tabs.query`。
5. 恢复事件的固定等待（150 ms、25 ms×10、1500 ms 退避）不可压缩，直接进入 p95/p99。
6. 版本全等门禁：扩展与运行时必须严格同步升级，任何一侧落后即整体不可用。

### 1.3 BrowserSkill 当前热路径（读源码与文档确认）

```text
Agent → shell → bsk CLI（Rust 进程）→ UDS/named pipe（JSON Lines）
      → bsk daemon（常驻，单实例锁）→ 常驻 WebSocket（本地 52800）
      → 扩展 ToolDispatcher → CDP / WebExt
```

特点：

- **常驻连接**：daemon 与扩展之间是长连接 WebSocket，不是轮询；断开后 1→2→4→8→16→30 s 指数退避重连。
- **每会话队列**：同一 session 的 RPC 串行（保护 ref-store），不同 session 并行。
- **类型化协议**：`bsk-protocol` 定义帧格式（request/response/event 三类），握手带 `protocol_version` 与 `version_skew` 状态。
- **effect_state**：写操作与文件传输返回 `none / committed / unknown`，unknown 明确保留、不盲目重试。
- **会话 = Agent Window + ref-store + borrow 表**：写操作默认只在自己的 Agent Window 内，操作用户标签页需显式借用。
- **代价**：每次工具调用经过 CLI 进程启动 + shell 往返；任务开始需建 Agent Window；借用用户标签页需确认。
- **无延迟基准**：其仓库只有评测 harness 与用例结构，没有发布可对比的 p50/p95 数据。

### 1.4 速度瓶颈排序（合并前必须承认）

1. 任务级往返次数与观察体量（attempt p50 520 ms）——收益最大。
2. 尾部恢复事件（15 分钟 840 次 stale-route、211 次 CDP 重挂）。
3. 全局单队列串行（多 agent / 多标签页场景）。
4. 长轮询空窗与每轮心跳的额外往返。
5. 版本全等门禁导致的"升级即中断"。
6. 主机负载敏感（25 s max 案例）。

因此：**先做 1–4 的机制改造，就能拿到大部分速度收益；重写内核换不到这部分收益。**

## 2. 三个深度方案

先明确"合并"的三个层次，避免把三个不同问题混成一个：

| 层次 | 含义 | 结果 |
| --- | --- | --- |
| 机制合并 | 不动代码结构，把对方的机制移植进自己内核 | 指标直接改善，1–2 个月见效 |
| 代码合并 | 单仓库、单内核、单扩展，双入口 | 维护性最好，成本最高，3–6 个月 |
| 产品合并 | 统一安装、统一分发、统一版本 | 面向普通用户，依赖代码合并 |

### 2.1 方案 A：机制合并（Yunti 内核 + BrowserSkill 机制）——推荐先做

**目标架构**

```text
Agent → MCP stdio ──┐
                    ├→ Yunti 内核（Node，本轮不动语言）
Agent → bsk CLI ────┘        │
                             ├─ 常驻 WebSocket 传输（替换长轮询）
                             ├─ per-page 队列（替换单 controller 串行链）
                             ├─ 类型化帧 + 握手 + 版本协商
                             ├─ pageHandleId + effect_state 恢复预算
                             └─ 可选：borrow / request-help / audit / transfer
```

**从 BrowserSkill 移植的机制**

1. 常驻 WebSocket 单连接（替换 `GET /extension/poll` 长轮询），带指数退避重连（1→30 s 封顶）。
2. 每 session/per-page 队列语义：同页串行、跨页并行、诊断低优先级。
3. request/response/event 三类帧 + 握手 + 能力协商 + `version_skew` 状态。
4. `effect_state`（none/committed/unknown）覆盖全部写操作，unknown 不盲目重放。
5. 重连与恢复的固定预算（把 150 ms、25 ms×10、1500 ms 这些散落等待收敛为统一的恢复预算与快速路径）。
6. 可选能力（默认关闭）：tab 借用、人工接管 request-help、操作审计、文件传输事务。

**明确不做**

- 不引入"每个任务必须创建 Agent Window"的强制流程（会拖慢默认路径）。
- 不引入 CLI 进程作为默认调用路径（MCP 直连保持不变）。
- 不改语言、不改 MCP 工具名与参数契约。

**速度影响（预期，待 P0 基线确认）**

- 消除长轮询空窗与每轮心跳往返：冷启动/断开恢复的首调用延迟下降。
- per-page 队列：多 agent / 多标签页并发时 p95 显著下降；单 agent 单页场景持平。
- 恢复预算收敛：p99 从 413 ms 目标压到 ≤ 250 ms。

**稳定影响**

- 类型化帧 + 能力协商替代"版本全等拒绝"，升级不再整体中断。
- effect_state 让超时语义可判定，消除"重试即重复写入"的隐患。
- 常驻连接 + 退避重连，MV3 worker 挂起、扩展重载、Bridge 重启的恢复路径更短。

**工作量**：6–9 周（含基准与回归）。**风险**：低（增量、可回退、随时停在任一阶段）。

**退出条件（验收）**：见第 4、5 节指标；0 重复写入、0 错页、恢复成功率 ≥ 99.5%。

### 2.2 方案 B：统一内核（代码合并，单仓库单扩展）

**目标架构**

```text
仓库：unified-browser-runtime
  kernel/     bsk-protocol 风格的类型化协议 + 常驻 daemon（Rust 或 Node 二选一）
  drivers/    content-script 驱动 + CDP 驱动（吸收 Yunti 的 observation/diagnostics）
  extension/  单一 MV3 扩展（WXT 结构 + Yunti 工具处理器）
  entry/      MCP adapter + bsk CLI adapter（共享同一内核）
  evals/      统一基准（Yunti 38 场景 + BrowserSkill 用例矩阵）
```

**必须完成的迁移**

1. 52 个 MCP 工具处理器迁入新内核（含 observe/find/CDP/network/console/trace/emulation/upload/preview patch）。
2. 单扩展合并：content script 注入、uid 生成、iframe/shadow、CDP attach 生命周期只保留一套。
3. 双入口：MCP（保持 `yunti_*` 名称与参数兼容）+ CLI（保持 `bsk` 命令语义）。
4. 版本与分发：单扩展发布（含商店路径）、协议兼容区间、迁移工具。

**收益**：单仓库单扩展，长期维护成本最低；直接继承 BrowserSkill 的远程配对与商店分发；类型化协议消除语言间契约漂移。

**成本与风险**：3–6 个月；Node→Rust 迁移 52 个工具 handler 与诊断层是主要工作量；期间需要"双扩展并存禁入"的原子切换，否则 debugger attach 与 content script 会互相冲突。风险：中高。

**进入条件**：方案 A 的指标全部达标，且出现以下任一信号——需要多人/多产品线维护、需要远程浏览器产品化、Node 内核在并发/资源上成为瓶颈。

### 2.3 方案 C：协议级并存（双运行时共享协议与扩展）

两个 daemon（Yunti bridge + bsk daemon）共享一套 schema 与一个扩展，各自保留入口。

**为什么最难**：两个 daemon 争抢同一扩展连接与同一标签页控制权；需要双 owner 检测、连接仲裁、版本矩阵与冲突回退。功能上等价于方案 B，但永久背两份运行时。

**结论**：除"必须同时保留两个既有产品线"外没有成立条件，**不建议**。

### 2.4 方案对比

| 维度 | A 机制合并 | B 统一内核 | C 协议级并存 |
| --- | --- | --- | --- |
| 速度收益 | 高（覆盖瓶颈 1–4） | 高（同 A，另加语言层收益，边际小） | 中（受仲裁层拖累） |
| 稳定性收益 | 高 | 高 | 中（冲突面大） |
| 工作量 | 6–9 周 | 3–6 个月 | 4–6 个月 |
| 风险 | 低 | 中高 | 高 |
| MCP 兼容 | 完全保持 | 需要适配层 | 需要适配层 |
| 分发/远程 | 后续可加 | 直接继承 | 复杂 |
| 推荐度 | ★★★★★ | ★★★★（A 达标后再做） | ★（不建议） |

**推荐路线：A → 用数据验证 → 决定 B。** A 的所有设计（协议、身份、队列、effect_state）都按"未来可迁移进 B"的标准来做，使 B 成为增量搬迁而不是推倒重来。

## 3. 无论选哪个方案都要做对的六个设计

### D1 传输：长轮询 → 常驻 WebSocket 双通道

- 帧格式：`{id, method, params}` / `{id, result|error}` / `{event, payload}`，与 bsk-protocol 对齐可直接复用其 schema。
- 握手：`system.handshake` 携带 `protocol_version`、`capabilities[]`；**兼容区间取代全等拒绝**（major 相同 + `min_compatible`）。
- 重连：1→2→4→8→16→30 s 指数退避封顶；恢复连接后由内核补发未决请求或明确返回 `transport_lost`。
- 双通道：控制帧（click/fill/observe）与诊断帧（network/console/trace）分流，诊断流量不得挤占操作队列。
- 保留兼容：HTTP bridge 作为调试/兼容入口保留一个版本周期，MCP 侧契约不变。
- 验收：空闲 5 分钟后首调用 p95 ≤ 50 ms；断连 3 s 后恢复首个调用 ≤ 1 s 且状态正确。

### D2 队列：per-page 串行、跨页并行、诊断低优先级

- 同一 page 的写操作严格串行；不同 page / 不同 browser 并行；只读操作不与写操作抢同一队列（同页读取按序执行）。
- 长任务（截图、录制、大文件、trace）独立槽位，不阻塞 click/fill。
- 每次调用返回分段耗时：`mcp_decode / transport / queue_wait / resolve / dispatch / postcondition / serialize`。
- 取消：`operationId` 从 MCP 穿透到控制器与浏览器驱动，取消必须可验证（不能只是停止等待）。
- 验收：两个 agent 在两个 tab 并发执行，p95 不劣化 > 20%；单页 10 次并发读取 queue_wait p95 ≤ 50 ms。

### D3 恢复：稳定身份 + 恢复预算矩阵 + effect_state

- `pageHandleId` 按 `docs/STABLE_PAGE_HANDLE_PLAN.md` 落地：agent 一次选择标签页，导航/重载/扩展重载/Bridge 重启对 agent 全部透明。
- 恢复预算矩阵（每类失败定义：检测信号、恢复动作、时间预算、是否允许重放、返回字段）：

| 失败类型 | 检测信号 | 恢复动作 | 预算 | 可重放 |
| --- | --- | --- | --- | --- |
| 内部 session 过期 | session 查不到 | 控制器重解析标签页 | ≤ 300 ms | 读：可；写：仅派发前 |
| content script 丢失 | 注入探测失败 | 重注入 + 探测 | ≤ 800 ms | 读：可；写：仅派发前 |
| MV3 worker 重启 | 心跳缺失 | 重连 + 会话重建 | ≤ 1 s | 同上 |
| CDP 分离 | Debugger.detached | 重挂目标 | ≤ 500 ms | 同上 |
| 标签页睡眠 | 注入超时 | 有界激活 + 注入 | ≤ 1.5 s | 同上 |
| Bridge 重启 | 连接断开 | 重连 + 路由恢复 | ≤ 2 s | 同上 |

- `effect_state`（none/committed/unknown）覆盖所有写操作；unknown 返回 `resultUncertain: true` 并禁止自动重试。
- 恢复必须在**单次工具调用内**完成，不再消耗 agent 层重试（这是当前 520 ms → 目标 300 ms 的关键）。
- 验收：重跑 15 分钟 soak，恢复 p95 ≤ 500 ms，0 盲目重放，0 错页。

### D4 观察与等待：Obs v2 瘦身 + auto-wait + find-first

- 默认不返回全量页面；能定位就用 `find_elements`；重复验证用 `delta`；全量 observe 仅在结构变化时使用。
- 观察输出改为行式紧凑语义树（VOM 风格：role/name/state/rect + `@ref`），而不是每个元素一个完整 JSON 对象；默认按 token 预算裁剪（建议默认 `maxTokens=2000`，可续读）。本次合成测量显示，完整 JSON 观察样本约 115 KB / 29k token，紧凑样本约 6.8 KB / 1.7k token，差约 17 倍。
- 支持 `cursor` 续读：被 token 预算截断时返回 continuation cursor，而不是让 agent 重新做一次全量 observe。
- ref-store 绑定 `documentGeneration`：观察后 refs 可跨多次动作复用；动作前运行时重新校验 ref，generation 未变且 ref 仍可解析时不必重新 observe；generation 变化则明确失败，不猜测。
- 等待订阅化：`wait_for` 不再占用页面执行队列，也不强制挂 CDP；由扩展侧 MutationObserver / rAF / URL 监听 / 可选网络静默条件在命中时回调，队列继续服务其它请求。
- 动作自带 settle 与 postcondition：click/fill/navigate 返回"已派发 + settle 后紧凑 delta + effect_state"，典型流程不再需要 `动作 → observe → 动作` 的三段式往返。
- 观察体量与耗时进入硬门槛（中位字节数、p95 字节数、元素数上限），并写进基准报表。
- 观察代（observationId）绑定 uid：过期 uid 明确失败并提示重新观察，不允许猜测。
- 验收：attempt p50 ≤ 300 ms、p95 ≤ 800 ms；观察体量 p50 ≤ 8 KB / 2k token、p95 ≤ 24 KB / 6k token；cached click p95 ≤ 250 ms；act+settle p95 ≤ 500 ms。

### D5 身份与错误契约：四层身份 + 结构化恢复提示

- 四层身份：`browserInstanceId`（浏览器实例）→ `pageHandleId`（标签页）→ `observationId`（观察代）→ `operationId`（单次操作）。
- 所有错误返回：`code / retryable / retryBudget / recoveryAction / resultUncertain / phase`，与现有 0.2.6 契约保持兼容。
- 任何内部状态替换不允许泄漏为 agent 可见的 stale 错误。

### D6 可选能力（从 BrowserSkill 移植，默认关闭）

| 能力 | 作用 | 默认 | 启用方式 |
| --- | --- | --- | --- |
| tab 借用 borrow/return | 显式操作用户标签页，带确认与超时 | 关 | 每任务显式开启 |
| 人工接管 request-help | 登录/验证码/OTP/确认，完成后继续 | 关 | 工具级调用 |
| 操作审计 | 任务级 after-action 记录，脱敏可导出 | 关 | 配置开启 |
| 文件传输事务 | 上传暂存、下载原子提交、unknown 保留 | 关 | 工具级调用 |
| Agent Window 隔离 | 任务独立窗口，不打扰用户 | 关 | 每任务显式开启 |
| 远程 WSS 配对 | 服务器 Agent 控制本地浏览器 | 关（且晚于本地） | 独立服务层 |

原则：**可选能力不得进入热路径**；未启用时不得增加任何一次往返或等待。

## 4. 量化验收目标

| 指标 | 当前实测 | 目标 | 测量方式 |
| --- | --- | --- | --- |
| tool-call p50 | 4–9 ms | 保持 ≤ 10 ms | 38 场景基准 |
| tool-call p95 | 213–435 ms | ≤ 100 ms | 同上（排除恢复路径） |
| tool-call max | 956–1406 ms | ≤ 1 s（恢复单列） | 同上 |
| 恢复路径 p95 | 未单独统计（埋点缺失） | ≤ 500 ms | 新增分段计时 |
| attempt p50 | 520 ms | ≤ 300 ms | 同上 |
| attempt p95 | 1501 ms | ≤ 800 ms | 同上 |
| 观察体量 p50 | 未发布；当前默认上限的合成样本约 115 KB / 28.8k token | ≤ 8 KB / 2k token | 基准报表 |
| 观察体量 p95 | 未发布 | ≤ 24 KB / 6k token | 基准报表 |
| cached click / act+settle p95 | 未单独统计 | ≤ 250 ms / ≤ 500 ms | 新增分段计时 |
| 跨页阻塞（A 页 5 s 等待时的 B 页 click） | 会被 controllerToolQueue 串行阻塞 | ≤ 300 ms | 并发用例 |
| 15 分钟 soak p99 | 413 ms | ≤ 250 ms | soak runner |
| 重复写入 / 错页 / 盲目重放 | 0 / 0 / 0 | 保持 0 | 基准 + soak |
| 恢复成功率 | 未统计 | ≥ 99.5% | 恢复矩阵用例 |

所有指标必须在同一台机器、同一负载条件下测量；主机过载的 25 s max 案例不得混入延迟基线。

## 5. 分阶段路线（每阶段独立可验收）

| 阶段 | 内容 | 周期 | 退出条件 |
| --- | --- | --- | --- |
| P0 对照基线 | 把 BrowserSkill 纳入同一 harness（同 fixture、同指标），产出对照数据；补齐分段计时埋点 | 1 周 | 两边各 ≥ 38×3 次运行，得到 p50/p95 与失败分类 |
| P1 队列与等待（先行） | 已完成：三层执行队列（tab 并行 / 未解析页排他 / 浏览器级并行）、`wait_for` 页面内订阅（去掉强制 CDP 挂载与 200 ms 轮询）。待做：诊断与大对象低优先级通道、分段计时埋点 | 1–2 周 | 单测已证明 A 页等待不再串行阻塞 B 页；≤ 300 ms 的墙钟指标、queue_wait p95 ≤ 50 ms、soak 全绿仍需真实浏览器 E2E 复测 |
| P1.5 传输 | 常驻 WebSocket + 双通道 + 重连退避；保留 HTTP 兼容入口 | 1–2 周 | 空闲 5 分钟后首调用 p95 ≤ 50 ms；tool-call p95 ≤ 100 ms（排除恢复路径） |
| P2 身份与恢复 | `pageHandleId` 落地；恢复预算矩阵；`effect_state` 全覆盖写操作 | 2–3 周 | 恢复 p95 ≤ 500 ms；0 盲目重放；基准 + soak 全绿 |
| P3 观察与等待 | Obs v2 瘦身、find-first、delta 默认策略、auto-wait 收敛 | 2 周 | attempt p50 ≤ 300 ms / p95 ≤ 800 ms；观察字节 -40% |
| P4 可选能力 | borrow / request-help / audit / transfer 事务，默认关闭 | 2–3 周 | 启用时才生效；未启用零额外开销 |
| P5 入口与产品化 | bsk CLI 兼容入口、单扩展发布、版本协商与迁移工具 | 按需 | 旧 MCP 配置无需改动；扩展升级不再中断 |

总计：到 P3 约 8–10 周，即可拿到目标中的全部速度与稳定性收益；P4/P5 是扩展面。

## 6. 风险与不做清单

风险：

- 双扩展共存会冲突（debugger attach、双 controller、重复 content script）——迁移必须原子切换，运行时检测到双 owner 必须拒绝而非竞争。
- 长轮询与 WebSocket 并存期间需要双传输支持，旧扩展必须快速失败并给出明确指引。
- 版本兼容区间放宽后必须配套能力协商，否则会出现"能连上但不能用"的静默失败。
- 性能结论必须在受控负载下测量；否则尾延迟不可复现。

不做：

- 不做一次性重写。
- 不默认创建 Agent Window。
- 不把 CLI 进程放进默认调用路径。
- 不把全部工具塞进默认上下文（保持 core / devtools / 按需分层）。
- 不在传输层做盲目重试。
- 不为"合并"而合并：每个改动都必须对应第 4 节的一项指标。

## 7. 待决策的三个问题

1. 默认模式：直接操作用户当前标签页（Direct）还是任务隔离窗口（Isolated）？建议 Direct 默认、Isolated 按任务可选。
2. 是否需要 `bsk` CLI 兼容入口？它决定 P5 的工作量与是否需要协议兼容层。
3. 是否接受"A 机制合并先行、用数据决定是否 B 统一内核"的顺序？如果要直接进入 B，需要接受 3–6 个月周期与更高风险。

---

附：本文件为方案稿，未修改任何运行时行为。工作区原有 3 个未提交文件（extension/content.js、tests/content-scroll.test.js、tests/e2e.test.js）保持原样。
