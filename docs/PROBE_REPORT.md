# 云梯 Browser Runtime 实测报告（并发 + 响应时间）

- **被测对象**：用户本机已安装的 Chrome 扩展 `yunti-browser-runtime` v0.2.7（本仓库当前工作区代码）
- **调用链路**：真实 MCP stdio JSON-RPC（`initialize` / `tools/list` / `tools/call`）→ 本地 Bridge `127.0.0.1:48887` → 扩展 controller 长轮询 → Content Script / CDP → 用户浏览器
- **测试页**：本仓库 fixture 静态页（`http://127.0.0.1:49771/controls.html` 等），由探针自带 HTTP 服务提供；**未触碰用户正在使用的页面**
- **探针代码**：`scripts/yunti-probe/`（`probe.js` 主流程、`input-probe.js` 输入通道、`ab-foreground-probe.js` 前后台对照、`fixture-server.js`、`report.js`）
- **原始数据**：`.probe-out-final/probe-report.json`（机器可读）、`.probe-out-final/PROBE_REPORT.md`（逐工具明细，由 `report.js` 生成）
- **覆盖**：`tools/list` 返回 **52/52** 个工具全部实际调用；共执行 6 轮完整/定点探针

---

## 一、结论速览

| 维度 | 实测结论 |
| --- | --- |
| 功能覆盖 | 52/52 工具均可调用；绝大多数在毫秒级返回正确结果 |
| 常规响应时间 | 观察/诊断类工具 **p50 11–40ms、p95 ≤ 60ms**；`yunti_get_tool_usage_hints` 3ms（进程内），诊断类 16–18ms（Bridge 内存态），页面类 20–90ms |
| 并发能力 | **工具调用是严格串行的**：4 个确定性 2.5s 的调用，任意路由方式墙钟都是 ~10.6s（串行 10s / 理想并行 2.5s） |
| 吞吐上限 | 实测约 **20–27 次/秒**（5 次并发 p50 25ms、16 次并发 255ms），瓶颈是"每轮长轮询只投递 1 个请求" |
| 最严重问题 | **原生模态对话框（alert/confirm/prompt）可把标签页彻底卡死**：`yunti_click` 永不返回，该页所有工具失去响应，`yunti_handle_dialog` 与裸 CDP `Page.handleJavaScriptDialog` 都救不回来 |
| 次严重问题 | 单次卡住的操作会**长时间占住该标签页的执行通道**，形成 25 秒级的级联超时（`take_screenshot`/`drag`/`click_at` 均观察到） |
| 数据完整性 | 长轮询空隙内扩展采集的 console/network 事件可能丢失（每轮重注册 + 最长 25s 长轮询期间无接收方） |

---

## 二、功能覆盖测试（52/52）

每个工具都用合法参数真实调用，并按"传输成功 / 语义成功"双维度判定（语义成功 = 结果未被 `code` 之类的结构化诊断标记为失败）。

### 2.1 全部通过的工具（49/54 次调用）

观察类（`get_page_snapshot` 11ms、`observe_page` 15ms、`take_snapshot` 40ms、`find_elements` 23ms、`get_selected_context` 14ms）、交互类（`click` 13ms、`hover` 20ms、`click_at` 8ms、`type_text` 27ms、`press_key` 13ms、`select` 17ms、`fill` 16ms、`fill_form` 15ms、`scroll` 16ms、嵌套容器 `scroll#nested` 32ms、`upload_file` 59ms、`drag` 在独立验证中 88ms）、诊断类（`list_network_requests` 16ms、`list_console_messages` 18ms、`get_network_log` 15ms、`get_cdp_events` 14ms）、CDP 类（`cdp_send_command` 87ms、`evaluate_script` 14ms、`performance_start_trace` 270ms、`performance_stop_trace` 159ms、`cdp_detach` 35ms）、生命周期（`new_page`、`close_page` 81ms、`navigate_page` 93ms、`select_page` 21ms）、内存与清理类全部通过。

同时校验了关键结构契约：

- `observe_page` 返回 `observationId`（`obs-…`），元素 uid 形如 `yunti-mujo2s3f-1-1`（**带观察作用域**，与 0.2.6 声明一致）
- 元素字段齐全：`uid/role/tag/name/label/placeholder/valueRedacted/type/rect/visible/disabled/editable/readOnly/fillable/checked/scrollable`
- `scrollableContainers[]` 在长页面上正确返回 1 个容器 uid
- 点击后页面状态可验证（`click produces a verifiable page change` ✅）
- `observe_page` 默认 `balanced` 脱敏：输入值以 `valueRedacted` 形式返回，未见明文

### 2.2 未通过项与归因

| 工具 | 现象 | 归因 |
| --- | --- | --- |
| `yunti_drag` | 主序列中 25.0s 超时（连续两轮复现） | **产品缺陷（级联）**：被前一个卡住的操作堵在同一标签页通道；独立验证中 88ms 正常 |
| `yunti_take_screenshot` | 主序列 25.1s 超时；延迟测试 5 次中 3 次失败 | **产品缺陷（级联 + 无看门狗）**：详见问题 P2 |
| `yunti_get_console_message` | 报 `msgId is required` | 探针依赖项：测试页 URL 未命中扩展的 `platformMatches`，没有采集到任何 console 消息（见问题 P5） |
| `yunti_handle_dialog` | 报 `No dialog is showing` | 探针依赖项：调用时确实没有对话框；定点测试已单独覆盖真实对话框场景 |
| `yunti_wait_for`（早期轮次） | `WAIT_TIMEOUT` | 探针自身错误（等待了当前页面不存在的文本），修正后 15ms 通过 |

---

## 三、并发测试

### 3.1 关键实验：确定性慢工具下的并发

用 `yunti_wait_for` 等待一个永不出现的选择器（固定 `timeoutMs=2500`），这样单次耗时是**确定值**，可以干净地区分"并行"与"串行"。并发 4：

| 场景 | 4 次调用总墙钟 | 相对理想并行 | 判定 |
| --- | --- | --- | --- |
| 同一标签页，经 MCP stdio | 10598ms | 4.2× | **串行** |
| 同一标签页，直接打 Bridge HTTP | 11558ms | 4.6× | **串行** |
| 同一标签页 + 显式 `tabId` | 10904ms | 4.4× | **串行** |
| 跨两个标签页（交替路由） | 10861ms | 4.3× | **串行** |

理想并行应为 ~2500ms，完全串行为 ~10000ms。四种路由方式全部落在串行区间，说明**瓶颈不在扩展的分道逻辑，而在桥接层的投递模型**。

`/console/state` 采样印证了这一点：6 个慢调用同时在途时 `pendingRequests=6`、`queuedRequests=0`、`pollers=1` —— 请求确实同时在扩展侧执行，但**每轮长轮询只投递 1 个请求**，所以投递速率被锁死在"一次一个"。

### 3.2 并发-延迟曲线

| 场景 | 并发 1 | 并发 4 | 并发 8 | 并发 16 | 失败 |
| --- | --- | --- | --- | --- | --- |
| 同页并行读（`get_page_snapshot`） | 39ms | 61ms | 116ms | 255ms | 0 |
| 同页并行观察（`observe_page`） | 18ms | 64ms | 128ms | 230ms | 0 |
| 同页混合读写（evaluate + snapshot + scroll） | 13ms | 99ms | 170ms | 244ms | 0 |
| 跨标签页并行读 | 17ms | 74ms | 95ms | 250ms | 0 |
| 直连 Bridge 并发 | 17ms | 45ms | 80ms | 222ms | 0 |

结论：

1. **并发 16 时墙钟约为串行的 1/N 关系**，即吞吐基本恒定、延迟随并发线性增长（排队），符合"单投递槽 + 请求串行服务"的模型。
2. **零失败**：即使在并发 16、混合读写的情况下也没有出现 uid 错乱、结果串号或超时。串行化虽然限制吞吐，但反过来保证了正确性。
3. 稳态吞吐约 **20–27 次/秒**（40 次连续调用 859ms，p50 17ms，max 46ms）。

### 3.3 一点澄清

仓库中扩展的注释声称"三通道并发模型（同标签页串行、不同标签页并行、inventory 无屏障）"，且单测 `tests/session-manager.test.js` 也断言了跨标签页并行。实测表明：**这套并行能力在真实端到端路径上无法被触发**，因为控制器每轮只被投递一个请求。这对 Agent 的实际影响是：

- 想要"同时观察 5 个标签页"，实际是逐页顺序执行，总耗时是线性累加；
- 但因为没有真并行，也就没有观察到竞态类错误 —— 这是一种"以吞吐换确定性"的取舍，值得在文档中明确写清。

---

## 四、响应时间测试

### 4.1 逐工具延迟（并发 1，各 5 次）

| 工具 | p50 | p95 | max |
| --- | --- | --- | --- |
| `yunti_get_tool_usage_hints` | 3ms | 3ms | 3ms |
| `yunti_get_page_snapshot` | 28ms | 32ms | 32ms |
| `yunti_observe_page` | 29ms | 30ms | 30ms |
| `yunti_find_elements` | 25ms | 29ms | 29ms |
| `yunti_take_snapshot` | 40ms | 59ms | 59ms |
| `yunti_evaluate_script` | 24ms | 37ms | 37ms |
| `yunti_cdp_send_command` | 23ms | 39ms | 39ms |
| `yunti_select_page` | 17ms | 18ms | 18ms |
| `yunti_scroll` | 22ms | 37ms | 37ms |
| `yunti_list_console_messages` | 17ms | 18ms | 18ms |
| `yunti_list_network_requests` | 17ms | 17ms | 17ms |
| `yunti_get_cdp_events` | 17ms | 18ms | 18ms |
| `yunti_get_network_log` | 17ms | 17ms | 17ms |
| `yunti_get_browser_target` | 26ms | 28ms | 28ms |
| `yunti_list_browser_targets` | 37ms | 43ms | 43ms |
| `yunti_wait_for`（命中） | 25ms | 29ms | 29ms |
| `yunti_take_screenshot` | **25046ms（超时）** | 25194ms | 25194ms |
| `yunti_capture_visible_tab` | **14173ms** | 25618ms | 25618ms |

对照项目自身的 soak 门禁（p95 ≤ 500ms、max ≤ 10s）：**常规工具的健康基线远优于门禁**；失败全部集中在两个图像类工具上。

### 4.2 延迟构成观察

- **进程内工具**（`get_tool_usage_hints`）3ms —— 纯内存。
- **Bridge 本地工具**（console/network/cdp-events/select_page）16–18ms —— 只走 HTTP，不碰浏览器。
- **页面工具**（snapshot/observe/find/evaluate/scroll）20–40ms —— HTTP + 长轮询投递 + 扩展 runtime 消息 + 页面 DOM + 结果回传。
- **图像工具** 250–1600ms（成功时）—— CDP `Page.captureScreenshot` 并 base64 回传（实测单张 ~37–550KB）。
- **偶发尖峰**：40 次连续调用中 p50 17ms 但 max 814ms，说明存在周期性卡顿（与控制器每 25s 的长轮询到期 + 重注册 + 会话清扫相关）。

---

## 五、发现的问题（按严重度）

### P0 — 原生模态对话框可把标签页彻底卡死

**复现（3 轮中出现 2 次）**：点击一个会弹出 `alert()` 的元素。

| 观测 | 结果 |
| --- | --- |
| `yunti_click` | 永不返回，25s 后被扩展超时判定 `Browser tool execution timed out inside the extension: yunti_click` |
| 同页 `yunti_get_page_snapshot` | 10.5s（本地超时）无响应 |
| `yunti_handle_dialog`（同页路由） | 8s 无响应 |
| `yunti_handle_dialog`（改从别的标签页 + 显式 tabId 发） | 返回 `No dialog is showing`（对话框确实已消失） |
| 裸 CDP `Page.handleJavaScriptDialog` | 返回 `No dialog is showing` |
| 收尾 `Target.closeTarget` | 10s 无响应（有一次） |
| 恢复 | 约 20s 后重新可用 |

**根因（代码级）**：`extension/content.js:361` 把 `yunti_request_user_confirmation` 实现为 `window.confirm()`；页面自身的 `alert()` 同理会冻结渲染进程 JS 线程。此时：

1. 点击的完成消息无法回传 → 该请求占住该标签页的执行通道；
2. 扩展的工具超时是 `25_000ms`，而 Bridge 默认 `30_000ms` —— **超时只能靠计时器兜底，无法中断运行中的操作**；
3. 25s 后扩展放弃并释放通道，页面才恢复；期间同页所有调用排队或超时。

**危害**：Agent 只要点到"删除确认""离开页面确认""错误弹窗"就会卡住整个标签页 20–25 秒，且期间该页不可观测，很容易被误判为"浏览器断连"并触发错误恢复流程。这是真实浏览器自动化最常见的场景之一。

**建议**：见第六节 O1。

### P1 — 单次卡住的操作会级联阻塞同一标签页，且没有看门狗

**现象**：主序列中 `yunti_drag` 25.02s、25.07s 连续两轮超时；`yunti_take_screenshot` 25.07s 超时；延迟测试中 `take_screenshot` 5 次失败 3 次、`capture_visible_tab` 失败 2 次；定点序列中 `drag-background-tab` / `activate-tab` / `drag-active-tab` / `drag-explicit-tabId` / `click-at-background` 连续 5 次全部 10.5s 无响应。

**同时**：在干净标签页上的同一批工具**毫秒级成功** —— `yunti_drag` 88ms、`yunti_click_at` 25ms、`CDP Input.dispatchMouseEvent` 10–52ms、`take_screenshot` 1603ms、`capture_visible_tab` 760ms（并返回 37.7KB 真实 PNG）。所以这不是参数错误或通道不可用，而是**当一个操作卡住时，后续所有同页调用连锁超时**。

**根因（代码级）**：

- 扩展侧同标签页严格串行（`extension/session-manager.js:216-240` 的 `tab:<id>` 通道），一个挂住的 `chrome.debugger.sendCommand` 会把后面全部堵住；
- 只有 `25s` 的整请求超时兜底，没有任何**单步**看门狗（`ensureCdpAttached`、`Input.dispatchMouseEvent`、`Page.captureScreenshot` 都是裸 `await`）；
- Bridge 侧超时后仅标记 `resultUncertain: true`，不会取消扩展侧仍在跑的操作。

**建议**：见第六节 O2、O3。

### P2 — 图像类工具的"成功但空图"与超时缺少可诊断性

- `yunti_capture_visible_tab` 在探针中多次返回 `ok: true`，但 `dataUrl` 为**空字符串**（MCP 层按 `dataUrl` 拆包成图片块，空串导致 `image` 块无数据）。同一工具在标签页处于前台时返回 37.7KB / 554KB 的真实 PNG。
- 实现是 `chrome.tabs.captureVisibleTab(session.windowId)`（`extension/tool-handlers.js:42`），**捕获的是窗口的活动标签页**，不是被路由的标签页；后台标签页会得到空图。这与工具名和文档描述存在歧义。
- 工具描述里承诺"截图"但没有 `bytes`/`empty` 之类的判别字段；调用方无法区分"截到空白页"与"根本没截到"。
- `yunti_take_screenshot` 三次 25s 超时（`Page.captureScreenshot` 无响应），失败信息只有 `resultUncertain`，没有失败阶段信息。

### P3 — MCP stdio 层完全串行

`mcp/server.js:337-352` 在 `for await` 内 `await handleJsonRpc(...)`，即**一个请求处理完才读下一行**。因此：一次 30s 超时会把该 MCP server 上所有后续调用全部堵住；希望并行探测多个页面的 Agent 会自然退化为串行。本地毫秒级调用时影响不大，但与 P0/P1 叠加时会把"卡一个标签页"放大成"卡住整个会话"。

### P4 — 采集类工具存在"静默为空"陷阱

`extension/network-monitor.js:47/71` 通过 `isPlatformUrl`（`extension/settings.js:59-66`，默认 `["*"]`）过滤后才上报。当用户的 `platformMatches` 不是 `"*"` 时：

- `yunti_list_console_messages` 返回空数组（本机实测：页面确实 `console.log` 了，返回 0 条）；
- 依赖消息 id 的 `yunti_get_console_message` 直接报 `msgId is required`；
- 网络类工具同理。

工具输出**没有任何"当前过滤规则/被过滤条数"的元信息**，Agent 会误判为"页面没有日志"。另外，每轮心跳都先 `POST /sessions/register`（`extension/session-manager.js:159`）再发起最长 25s 的长轮询，**这段空隙内扩展没有接收方**，期间发生的 console/network 上报会丢失（`postBridge(...).catch(() => {})` 静默吞掉）。

### P5 — 参数与前置条件错误的语义不统一

| 工具 | 现象 | 期望 |
| --- | --- | --- |
| `yunti_handle_dialog`（无对话框） | `{code:-32602,message:"No dialog is showing"}` 判为失败 | `ok:true, handled:false` 或 `code:"NO_DIALOG"` |
| `yunti_get_console_message`（无 msgId） | `msgId is required` | `code:"MISSING_PARAMETER"` |
| `yunti_drag` / `yunti_click_at`（缺坐标） | `fromX, fromY, ... are required and must be numbers` | 同上 |
| 未知 tabId | `could not establish a page session for tabId N: Frame with ID 0 is showing error page` → 归类为 `YUNTI_TOOL_ERROR`（`retryable:false`） | 归类 `YUNTI_SESSION_STALE` + `recoveryAction: list_targets_then_retry_once` |

而 `yunti_click`/`yunti_fill`/`yunti_scroll` 等会返回结构化诊断（`clicked:false` + `code:UID_NOT_FOUND` + `recoveryHint`）。同一套工具里的错误契约不一致，Agent 难以按 `SKILL.md` 的"读 `retryable`/`recoveryAction`"规则统一处理。

### P6 — 小问题

- `yunti_new_page` p50 约 900ms、单次最高 23.6s（等待页面 ready），明显慢于其他工具（本轮实测 0.6s–23.6s）；返回的 `browserSessionId` 与 `tabId` 在联调中容易混用（探针必须再 `list_browser_targets` 才能拿到 tabId）。
- 失败结果只带 `code` 不带 `message`（如超时类），排查要回到 `/console/state`。
- 早期轮次中出现过 `yunti_new_page(active:false)` 之后页面停在空白页、后续全部 `UID_NOT_FOUND`/`ELEMENT_NOT_FOUND` 的情况；在标签页确认落地后不再复现，属于需要继续观察的边缘问题。

---

## 六、优化建议（按性价比排序）

### O1（P0，必做）让点击类工具对原生对话框"可返回、可恢复"

1. 在扩展 CDP 控制器里订阅 `Page.javascriptDialogOpening`（`extension/cdp.js` 已有事件通道），记录"当前对话框来自哪个工具请求"。
2. `yunti_click`/`yunti_click_at`/`yunti_type_text`/`yunti_press_key` 的等待逻辑改为**事件驱动 + 短上限**：一旦收到 `javascriptDialogOpening`，立即以 `ok:true, dialogOpened:{type,message},resultUncertain:true` 返回，而不是继续等待完成消息。
3. `yunti_handle_dialog` 在无对话框时返回 `ok:true, handled:false, code:"NO_DIALOG"`，并支持"按标签页指定"（而不是只能走当前路由）。
4. 给页面工具增加"检测到模态即中断"的兜底：超时前若发现 `Page.javascriptDialogOpening`，直接返回可恢复错误而不是等满 25s。

**预期效果**：点击弹窗类元素从"卡死 25s + 整页失联"变为"毫秒级返回 + 明确指引"，这是本次测试最大的可用性改进。

### O2（P1）加单步看门狗，避免一个操作拖垮整页

- 对 `ensureCdpAttached` / `Input.dispatchMouseEvent` / `Page.captureScreenshot` / `DOM.setFileInputFiles` 等裸 `await` 加 3–5s 的单步超时（`Promise.race` + `AbortController`），失败即返回结构化错误并**释放该标签页通道**。
- 在 `session-manager.js` 的通道实现里记录"当前占用者（tool + 起始时间）"，超过阈值时对后续同页请求直接返回 `code:"TAB_BUSY", retryable:true, retryAfterMs`，而不是让调用方一起等到 25s。
- 让扩展侧超时（25s）明显小于 Bridge 侧（30s）**且可配置**，并在错误里带上阶段名（`attach` / `dispatch` / `capture`）。

### O3（P1）截图/可见标签页截图：给出可判别结果与降级

- `captureVisibleTab` 得到空串或长度异常时，自动降级到已存在的 CDP `Page.captureScreenshot` 分支（代码里已有该回退，只是仅在抛错时触发），并在返回值里加 `bytes`、`empty:true`、`capturedTabId`、`fallback:"cdp"`。
- 明确语义：需要"某个指定标签页的图"就用 `yunti_take_screenshot`，需要"用户当前看到的画面"才用 `capture_visible_tab`；文档和工具描述都要写清"捕获窗口活动标签页"。

### O4（P3）解除 MCP stdio 的全局串行

`mcp/server.js:337-352` 改为不阻塞读循环：读一行 → `void handleJsonRpc(...).then(write)`。JSON-RPC 允许乱序响应（以 `id` 关联），这样慢调用不再堵住快调用，Agent 的并行探测才真正有意义。

### O5（P1，吞吐）把"每轮长轮询只投递 1 个请求"改成可批量

Bridge 侧 `session.pollers.shift()` 一次只给 1 个 payload；建议支持"一次 poll 返回最多 N 个待执行请求"（或让扩展在一次响应后立即续投），把实测 20–27 次/秒的吞吐上限抬高一个量级。配合 O2 的通道占用保护，可安全地把跨标签页并行真正跑起来。

### O6（延迟）削减每轮固定开销

- 扩展重注册为心跳语义，不必每轮都 `chrome.tabs.query({}) + POST /sessions/register + getSettings()`；可把注册降频、`getSettings` 结果缓存并在 storage 变更时失效。
- 这样能直接压掉那批 40 次连续调用中 800ms 级的周期性尖峰。

### O7（P2，并发）把 `tabId` 明确放进页面工具契约

让 `observe/click/fill/...` 也接受 `tabId`/`targetId`（或用 `browserSessionId` 直接推导出 tabId），使扩展的分道判定不再依赖调用方额外传参；同时给 `browserSessionId` 到 tab 的映射加版本校验（当前 uid 映射与 session id 不一致时的静默误点风险，见审计文档）。

### O8（P4）采集类工具补"过滤可见性"

`list_console_messages` / `list_network_requests` / `get_network_log` 的返回里加 `platformMatches`、`filteredByUrl`、`droppedWhilePolling` 等元信息；空结果时明确 `code:"NO_CAPTURED_EVENTS"` 并给出"检查扩展 popup 的 platformMatches"的 `nextStepHint`。

### O9（P5）统一错误契约

引入 `code` 枚举：`MISSING_PARAMETER` / `INVALID_PARAMETER` / `NO_DIALOG` / `NO_CAPTURED_EVENTS` / `TAB_BUSY` / `STALE_TAB`，并为全部工具保证 `retryable`、`retryBudget`、`recoveryAction`、`nextStepHint` 一致填充。

### O10（测试）补并发与对话框的回归测试

`tests/session-manager.test.js` / `tests/tool-handlers.test.js` 目前所有用例都是顺序 `await`，且 `cdp.js` 无单测。建议补：

- 单轮长轮询下 N 个并发 `callTool` 的投递/完成断言（可直接用 `scripts/yunti-probe/probe.js --phase=concurrency` 的思路固化）；
- 原生对话框中途打开 → 必须有界返回的用例；
- 一个操作挂住时同页后续请求的 `TAB_BUSY` 行为；
- `captureVisibleTab` 空图的降级路径。

---

## 七、复现方式

```bash
# 前置：扩展已在本机 Chrome 中加载并连上 127.0.0.1:48887

# 全量探针（覆盖 52 工具 + 延迟 + 并发 + 定点复现），约 12 分钟
node scripts/yunti-probe/probe.js --phase=all --iterations=5 --levels=1,2,4,8,16 --out=.probe-out-final

# 只跑定点复现（对话框死锁 / 截图卡顿 / 拖拽 / console 采集），约 2 分钟
node scripts/yunti-probe/probe.js --phase=focused --out=.probe-out-focused

# 输入通道对照（CDP 鼠标 vs uid 点击，截图返回体）
node scripts/yunti-probe/input-probe.js

# 生成 Markdown 明细
node scripts/yunti-probe/report.js --in=.probe-out-final/probe-report.json --out=.probe-out-final/PROBE_REPORT.md
```

探针安全约定：所有测试页面由本地 fixture 服务提供；测试标签页默认后台创建并在结束时关闭；不读取、不修改用户已有页面；仅在验证 `capture_visible_tab` 与原生对话框时短暂激活自己的测试标签页，并在结束后恢复用户原来的活动标签页。

---

## 八、附：与仓库既有工程质量的关系

需要说明的是，本项目已有的工程质量明显高于本次暴露的问题数量：0.2.6 声称的 38/38 场景 benchmark、15 分钟 soak（52/52 工具、p95 213ms）在本机常规工具延迟上是可以复现的（观察类 p50 11–40ms，远优于 500ms 门禁）。

本次暴露的问题恰好落在既有测试体系的**盲区**上：

- benchmark/soak 都是**顺序驱动**、且在自己的 Playwright 隔离 profile 中运行，覆盖不到"用户真实浏览器里的原生对话框"和"标签页被卡住后的级联"；
- soak 里 `yunti_cdp_detach` 是"每个循环第 4 次"调用，但没有断言 detach 之后立刻的截图行为；
- 没有"并发投递"的端到端断言，所以三通道并行在实际路径上失效这件事不会被现有测试发现。

建议把本文的 P0/P1 两条场景补进 soak/batch 回归，并把 O10 的并发断言加进 `npm test`。

---

## 九、交付物与说明

| 文件 | 内容 |
| --- | --- |
| `docs/PROBE_REPORT.md` | 本报告（结论、问题、优化建议） |
| `docs/audits/yunti-concurrency-latency-audit.md` | 扩展侧并发/延迟实现审计（逐行 file:line 证据），用于支撑 O2/O4/O5/O7 |
| `scripts/yunti-probe/probe.js` | 主探针：52 工具功能覆盖 + 延迟 + 并发 + 定点复现 |
| `scripts/yunti-probe/input-probe.js` | 输入通道对照（CDP 鼠标 vs uid 点击）与截图返回体校验 |
| `scripts/yunti-probe/ab-foreground-probe.js` | 前后台标签页截图对照 |
| `scripts/yunti-probe/fixture-server.js` | 本地测试页服务（含表单、滚动、异步、shadow、dialog、console、上传页） |
| `scripts/yunti-probe/report.js` | 由探针 JSON 生成逐工具 Markdown 明细 |
| `.probe-out-final/probe-report.json` | 最终一轮全量原始数据（机器可读） |
| `.probe-out-final/PROBE_REPORT.md` | 自动生成的逐工具明细表 |

几点测量口径说明，避免误读：

1. **测试环境是"用户正在使用的浏览器"**：用户当时开着多个标签页、机器负载会波动，因此图像类工具的偶发 25s 卡顿在不同轮次间不稳定（3 轮中 1 轮全通过）。**P0 对话框死锁在 3 轮中复现 2 次**，是最稳定、最值得优先修的问题。
2. 报告里的"语义成功"以工具返回的 `code` 为准；参数缺失类错误（`msgId is required` 等）计为失败，但它们同时暴露了 P5 的错误契约不一致问题。
3. 所有延迟都是**端到端**（MCP stdio 客户端计时到收到响应），包含 MCP 层、Bridge、长轮询投递、扩展与页面执行的全部耗时，比项目内部 soak 的"工具执行耗时"口径更保守。
