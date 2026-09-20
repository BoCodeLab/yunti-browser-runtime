# Execution Plan

本文档记录 Yunti Browser Runtime 从本地 MVP 走向可开源、可长期稳定使用版本的执行计划。

## 0.2.7 当前执行锚点

`0.2.7` 是基于已发布 `0.2.6` 的页面 UI 热修复：移除注入页面的 `AI` 悬浮按钮和
「刷新连接」面板，不包含未完成的 P8 stable page handle 工作。详细范围见
[RELEASE_0_2_7.md](RELEASE_0_2_7.md)。

在同一版本内追加了 P0-P2 门禁与契约加固，仍未新增 MCP 工具、未变更协议版本：

1. release 门禁跨平台化（npm CLI 入口解析、路径分隔符归一化、
   `npm pack --json` 两种返回形态）：已完成，`npm run release:check` 在 Windows
   上 exit 0。
2. Windows 必红用例修复与真实浏览器 E2E 去空转：已完成，
   `YUNTI_E2E=1 npm run test:e2e` 在真实 Chromium 扩展加载下通过。
3. 抛错路径保留结构化失败契约（`failure` 字段贯通 extension → bridge → MCP）：
   已完成。
4. HTTP 长轮询层服务端集成测试：已完成，见 `tests/http-server.test.js`。
5. `yunti_take_snapshot` uid 与 rect 解耦（`DOM.getBoxModel` 视口 rect 富化）：
   已完成。
6. 状态文档回填（发布状态、zip 清单、权限清单、P6 状态、工具数量）：已完成。

### 0.2.6 执行锚点（历史）

`0.2.6` 发布观察作用域 uid、deep wait、开放 Shadow DOM 坐标操作、完整 38
场景 benchmark 和 Edge 延迟门禁。详细范围与验收见
[RELEASE_0_2_6.md](RELEASE_0_2_6.md)。

执行顺序：

1. 完成 38/38 benchmark 场景并拆分 attempt/tool-call/scenario 指标：已完成。
2. 观察作用域 uid、deep wait 和开放 Shadow DOM 坐标操作：已完成。
3. Edge 15 分钟全工具耐久测试与 p95/max 门禁：候选验收通过；最终树超载诊断
   通过功能、覆盖和 p95，max 受主机 load 115 影响失败，证据已保留。
4. Skills、README、发布说明与版本引用同步：已完成。
5. 完整 unit/release check、npm 发布和 registry 验证：已完成，`latest=0.2.6`。

本版本不新增 MCP 工具，不推进 remote mode，也不引入协议破坏。

## Post-0.2.3 / P8 当前执行锚点

详细竞品证据、Yunti 代码缺口和 P8 验收指标已沉淀到
[COMPETITOR_RESEARCH_2026.md](COMPETITOR_RESEARCH_2026.md)。恢复上下文时，应先
读取该文档，再阅读本文的历史执行记录。

当前原则：

- 重点吸收 Alibaba Page Agent 和 browser-use；停更项目不进入优先级。
- 其他活跃项目只用于校准 actionability、诊断、安全和评测契约。
- 不改变 Yunti local-first、existing-browser、MCP-native、无强制 LLM、细粒度
  `yunti_*` 工具、单 controller 会话恢复和 CDP 完整能力。
- P8 每次只推进一个可验收切片，先记录目标、非目标和指标，再改代码。
- 不确定的写操作绝不跨后端盲目重放。

当前 P8 阶段总览：

| 阶段 | 状态 | 交付目标 |
| --- | --- | --- |
| P8 调研与差距审计 | 已完成 | 主参考、代码证据、护栏、P0-P2 路线 |
| Edge session recovery hotfix | 本地已完成 | Edge sleeping tab 探测/注入超时、controller 非阻塞 poll、watchdog、旧 session 自动恢复 |
| P8.0 | 已完成基线 | 30+ 场景 benchmark，记录 `0.2.3` 成功率、恢复率、错误动作、延迟和观察体积 |
| P8.1 | 第一轮已完成 | Observation v2：find、delta、iframe/shadow 深层目标 |
| P8.2 | 已启动，P8.2.1-P8.2.3 完成 | 下一优先级 P8.2.4 stable page handle；随后补 typed lifecycle、取消和后置验证 |
| P8.3 | 未开始 | 可验证语义目标 recipe 和安全自愈 |
| P8.4 | 未开始 | 脱敏 trajectory、failure bundle 和 replay |
| P8.5 | 未开始 | origin policy、不可信页面内容标记、注入攻击 fixtures |
| P8.6 | 未开始 | core/devtools/full profile、扩展商店更新路径 |
| P8.7 | 后置 | 可选远程浏览器 provider，不改变本地默认 |
| P8.8 | 后置 | Lighthouse、性能洞察、screencast、heap diagnostics |

下一步自然推进提示词：

```text
继续推进 Yunti Browser Runtime。先读取 docs/COMPETITOR_RESEARCH_2026.md、
docs/PROJECT_STATUS.md、docs/EXECUTION_PLAN.md 和 docs/NEXT_MAJOR_PLAN.md。
Page Agent 和 browser-use 是主参考，停更项目不进入优先级；不要把 Yunti 改成任何
竞品的克隆。`0.2.6` 已发布，P8.2.1-P8.2.3 已完成；不回退到要求用户刷新页面。
下一步按 docs/STABLE_PAGE_HANDLE_PLAN.md 推进 P8.2.4a，只实现 additive 的
`pageHandleId` 契约和共享 route resolver：现有 browserSessionId/tabId/targetId 保持兼容，
不提前混入 P8.3。每个切片都用 benchmark 记录成功率、错误动作率、内部 session 恢复、
重复写入和正常/恢复调用的 p50/p95/max。
保留 local-first、existing-browser、MCP-native、单 controller、细粒度工具、
redaction 和 unrestricted CDP。
```

P8 当前已完成切片：

- P8.0 benchmark baseline 已完成：首轮可用基线 artifact 位于
  `.artifacts/benchmark/2026-07-19T05-33-41-631Z/`，15/15 已实现场景通过，
  duplicate writes 为 0，p50 duration 112 ms，p95 duration 10227 ms。
- P8.1.1 已完成：新增 `yunti_find_elements`，提供 bounded targeted find，
  降低必须整页 observe 才能定位单一目标的成本。
- P8.1.2 已完成：`yunti_observe_page`、`yunti_find_elements` 和
  `scrollableContainers[]` 现在会递归覆盖 open shadow roots，并显式排除
  Yunti 自身注入 widget，避免 agent 把扩展 UI 当成业务目标。
- P8.1.3 已完成：`yunti_observe_page` 和 `yunti_find_elements` 现在会递归覆盖
  same-origin iframe 内的交互目标与 scrollable container；返回 rect 会折算到
  顶层 viewport 坐标。内容脚本的坐标命中路径也已同步支持 same-origin iframe，
  因此 observe 得到的新 uid 在 click/fill/type/select/press 的既有坐标链路上仍可
  用。当前仍未引入多 frame 独立 session，也不覆盖跨域 iframe。
- P8.1.4 已完成：`yunti_observe_page` 新增 additive 的
  `responseMode: "delta"`。delta 模式会相对上一次 observe 返回更轻的页面/滚动
  变化摘要、文本树变化标记、变化计数和 bounded changed-entry metadata，而不会替换
  正常 full observe 的 actionable uid map。适合重复验证，不适合直接选择下一步 uid。
- P8.2.1 已完成：先把 selector 路径收成第一版统一 actionability / bounded
  auto-wait。content script 里的 selector click、hover、fill、type、press 和
  select 现在共享短等待和 readiness 检查，覆盖 presence、visibility、
  enabled/editable、tag expectation 和 receives-events。目标存在但暂时不可操作时，
  结构化失败会明确提示先 wait/observe 再重试，而不是把失败都折叠成同一种 selector miss。
- P8.2.2 已完成：deep wait、观察作用域 uid 和 open-shadow coordinate action 已进入
  `0.2.6`，38/38 benchmark 通过。
- P8.2.3 已完成：soak runner 已加入 p95/max 延迟门禁、p99、逐工具分布和慢调用记录。
- P8.2.4 方案已冻结：新增稳定 `pageHandleId`，把页面 session 轮换收进 runtime，
  详细契约、非目标、五个实现切片和 100 次 session replacement 验收见
  [STABLE_PAGE_HANDLE_PLAN.md](STABLE_PAGE_HANDLE_PLAN.md)。下一步只推进 P8.2.4a。
- Edge session recovery hotfix 已完成本地实现和真实 Edge 150 验证：controller poll
  不再 await 整个工具执行；content-script probe/injection 和工具执行均有有界超时；
  recovery alarm 会通过 poll-progress watchdog 替换卡死 poller；Edge sleeping tab
  后台注入卡住时会临时激活目标 tab、完成注入后恢复原 tab。真实验证覆盖安装后零页面
  session 发现 21 个旧 tab、同一 sleeping tab 自动恢复，以及扩展 reload 后继续使用旧
  page session id，均不要求刷新页面。

P8.0 详细计划：

- 基线文档已写入
  [RELIABILITY_BENCHMARK_PLAN.md](RELIABILITY_BENCHMARK_PLAN.md)。
- benchmark 契约、38/38 场景矩阵、指标 v2、artifact 规则、fixture 页面、runner、
  npm 脚本和验证测试均已完成；首轮 `0.2.3` baseline 与 `0.2.6` release-tree capture
  都已记录。
- 当前自然推进顺序不是回退重跑基线，而是先完成 P8.2.4 stable page handle：
  contract/resolver -> navigation/context replacement -> restart recovery ->
  typed lifecycle/cancellation -> Agent contract/endurance gate。P8.3 自愈 recipe 在此之后。

维护规则：

- 每完成一个阶段，都要更新本文档的状态。
- 每个阶段开始前先确认目标、范围、验收标准。
- 不把远程多用户能力混入本地单用户核心。
- 安全和稳定优先于功能堆叠。

## 当前总目标

把当前本地 MVP 打磨成一个：

- 安装简单；
- 默认安全；
- Agent 不容易误用；
- 能稳定操作真实浏览器；
- 可作为开源项目发布；
- 后续可扩展远程模式但不依赖远程模式；

的本地浏览器运行时。

## 阶段总览

| 阶段 | 状态 | 目标 |
| --- | --- | --- |
| P0.1 | 已完成 | bridge token + CORS 收紧 |
| P0.2 | 已完成 | session TTL / 心跳 / 快速恢复 |
| P0.3 | 已完成 | browser controller 心跳 / 页面按需注册 |
| P0.4 | 已完成 | 单 controller 传输 / 页面 session 稳定恢复 |
| P0.5 | 已完成 | CDP 一等能力 / 成功率优先的后端选择策略 |
| P0.6 | 本地已完成 | Edge sleeping tab / 卡死 controller poller 自动恢复 |
| P1.1 | 已完成 | doctor 增强 |
| P1.2 | 已完成 | MCP config printer |
| P1.3 | 已完成 | extension 打包脚本 |
| P1.4 | 已完成 | 真实浏览器 E2E smoke test |
| P2.1 | 已完成 | README 和文档开源化 |
| P2.2 | 已完成 | npm package metadata / bin |
| P3.1 | 已完成 | 大文件拆分与模块化 |
| P3.2 | 已完成 | 工具参数校验与错误提示增强 |
| P4.1 | 已完成 | 发布前文档与权限审查 |
| P4.2 | 已完成 | Agent 接入示例补全 |
| P4.3 | 已完成 | npm 发布 URL 最终确认 |
| P4.4 | 已完成 | 发布门禁脚本固化 |
| P4.5 | 已完成 | 发布运行手册 |
| P4.6 | 已完成 | package metadata 检查命令 |
| P4.7 | 已完成 | prepublish 发布门禁串联 |
| P4.8 | 已完成 | npm package 内容门禁 |
| P4.9 | 已完成 | extension zip 内容门禁 |
| P4.10 | 已完成 | package / extension 版本一致性门禁 |
| P4.11 | 已完成 | npm bin CLI smoke 门禁 |
| P4.12 | 已完成 | Agent config smoke 门禁 |
| P4.13 | 已完成 | doctor JSON smoke 门禁 |
| P4.14 | 已完成 | 公开文档相对链接门禁 |
| P4.15 | 已完成 | npm 官方 registry 发布脚本 |
| P4.16 | 已完成 | 正式发布脚本内置门禁 |
| P4.17 | 已完成 | npm 登录预检门禁 |
| P4.18 | 已完成 | npm 发布后验证命令 |
| P4.19 | 已完成 | npm 正式发布执行 |
| P5.1 | 已完成 | 本地默认免 bridge token |
| P5.2 | 已完成 | 扩展 popup 与安装引导简化 |
| P5.3 | 已完成 | 扩展首屏零配置 |
| P6.0 | 已完成 | 0.2.0 产品方向护栏 |
| P6.1.1 | 已完成 | `yunti_observe_page` schema、tool hints、bridge routing |
| P6.1.2 | 已完成 | content-script DOM observer、文本树、字段状态、scroll 元数据、最小脱敏 |
| P6.1.3 | 已完成 | fresh observe uid 兼容现有 click/hover/fill action |
| P6.1.4 | 已完成 | 真实浏览器 `observe -> click uid -> observe/verify` 闭环 |
| P6.2.1 | 已完成 | action result 兼容契约与主要 action 主路径结构化字段 |
| P6.2.2 | 已完成 | `yunti_select` uid/selector/value/text 语义与失败诊断 |
| P6.2.3 | 已完成 | `yunti_fill` / `yunti_fill_form` 字段状态、contenteditable、值保持诊断 |
| P6.2.4 | 已完成 | `yunti_scroll` uid/coordinate/no-movement/partial/fallback 诊断 |
| P6.2.5 | 已完成 | 异步 UI 的 `wait -> observe -> fresh uid` 恢复指导 |
| P6.2.6 | 已完成 | `yunti_wait_for` 自身结构化 action result 与恢复语义 |
| P6.2.7 | 已完成 | 结构化 action result 覆盖审计与真实浏览器闭环补验准备 |
| P6.3.1 | 已完成 | Agent 默认工作流契约与可复制提示词 |
| P6.3.2 | 已完成 | Tool Guide 最小用例：点击、填表、滚动找元素、切 tab、等待异步结果 |
| P6.4.1 | 已完成 | DOM 脱敏策略深化，与 network/console redaction 对齐 |
| P6.4.2 | 已完成 | learning memory / diagnostic artifacts 的 secret 边界收敛 |
| P6.4.3 | 已完成 | raw CDP / screenshot 非默认脱敏诊断的提示与清理边界 |
| P6.5.1 | 已完成 | 可选本地运行时控制台最小闭环 |
| P6.5.2 | 已完成 | 控制台诊断增强第一刀 |
| P6.5.3 | 已完成 | 控制台真实浏览器验收与 UX 收口 |
| P6.6.1 | 已完成 | 浏览器扩展分发准备 |
| P6.6.2 | 已完成 | 商店权限与隐私文案草案 |
| P6.6.3 | 已完成 | 商店前权限策略决策 |
| P6.6.4 | 后置 | Store candidate 权限 UX 设计 |
| P7.1 | 已完成 | 0.2.0 npm/unpacked 发布收口 |

当前 0.2.0 推进快照（2026-07-05）：

- P6.2 最新完成切片：
  - action result 主路径覆盖；
  - `yunti_select` selector/value、uid/value、uid/text；
  - select uid/selector 失败诊断与 disabled option 诊断；
  - contenteditable fill；
  - selector/uid fill 失败诊断与 `yunti_fill_form` 聚合诊断；
  - uid scroll、scroll no-movement、directional `edgeHint`、结构化 `recoveryHint`、
    机器可读 `decision` 和可执行 `suggestedRetry`；
  - scroll partial movement 的 `partialMovement` 观察前置诊断；
  - uid scroll 缺失/过期/不可解析目标的结构化恢复诊断；
  - coordinate scroll 命中元素、滚动容器、document fallback 诊断和恢复提示；
  - fill/select/scroll 异步 UI 的 `wait -> observe -> fresh uid` 恢复指导；
  - uid/selector fill 不可编辑、隐藏、disabled、readonly 目标诊断；
  - uid fill 填后值保持验证与 `VALUE_NOT_APPLIED` 长度级诊断；
  - `yunti_observe_page` 字段状态、select 当前选中项与 `options[]` 提示。
- P6.1：`yunti_observe_page` schema、tool hints、bridge routing、content-script observer
  和 deterministic fixtures 已落地；真实浏览器 `observe -> click uid -> observe/verify`
  闭环已在本机 `pytest-playwright` 环境下用临时 Node Playwright 1.58.0 补验通过。
- P6.2：结构化 action result 正在按兼容优先的小切片推进；已覆盖主要单动作路径：uid click/hover/fill
  keyboard/fill select、coordinate click/hover、selector hover/click/fill passthrough 和
  scroll passthrough、type_text uid/selector fallback、press_key uid/selector fallback、
  upload uid/selector path、coordinate drag、standalone `yunti_select` content-script
  passthrough、aggregate `yunti_fill_form` summary；`yunti_select` 也已补齐 selector/value、
  uid/value、uid/text 三条路径，并开始返回 uid 与 selector option miss / non-select target
  的结构化失败诊断；更深语义已推进到 contenteditable fill、selector/uid fill 失败诊断、fresh
  observed scroll container uid、scroll no-movement、directional `edgeHint`、结构化
  `recoveryHint`、机器可读 `decision` 和可执行 `suggestedRetry` 诊断。
- P6.2 第一轮 action result 覆盖、select uid/text、contenteditable fill 和 scroll
  recovery diagnostics 已补齐；selector/uid fill 失败诊断和 `yunti_fill_form` 聚合诊断也已落地。
  uid/selector fill 的不可编辑、隐藏、disabled/readonly 目标诊断也已补齐：失败时返回
  `filled: false`、`ok: false`、`code: "TARGET_NOT_EDITABLE"`、`recoveryHint` 和
  `nextStepHint`，并保留所有既有成功路径、兼容字段与 CDP fallback。下一步继续进入更深的
  select/fill/scroll 语义增强与真实浏览器闭环补验。`yunti_observe_page` 也开始为字段类元素
  暴露 `editable`、`fillable`、`readOnly`、`fillBlockReason`、select 当前选中项摘要和
  `options[]` 摘要，让 agent 在填表或选择前先判断字段状态。
- P6.2 uid fill 的填后验证已补齐：keyboard/contenteditable 路径会在派发输入后尽量读取
  目标字段的长度级状态；如果页面框架、mask 或受控状态导致值没有保持，返回
  `filled: false`、`ok: false`、`code: "VALUE_NOT_APPLIED"`、`expectedValueLength`、
  `actualValueLength`、`recoveryHint.decision: "inspect-controlled-or-masked-field-before-retry"`
  和 `nextStepHint`。该诊断不回传实际字段内容，只回传长度摘要；既有成功路径和兼容字段保持不变。
- P6.2 scroll partial movement 诊断已补齐：当 `before` / `after` 可比较且 scroll
  实际移动距离小于请求 `deltaX` / `deltaY` 时，结果保持 `ok: true`，并新增
  `partialMovement`，包含 requested/actual delta、affected axes、`edgeHint`、
  `decision: "observe-before-continuing-scroll"` 和 `nextAction: "observe-again"`。
  该诊断用于提示 agent 先重新 observe 和比较滚动位置，再决定是否继续滚同一容器。
- P6.2 uid scroll 失败诊断已补齐：当 uid 缺失、过期、隐藏或无法解析坐标时，
  `yunti_scroll` 返回 `scrolled: false`、`ok: false`、`recoverable: true`、
  `code: "UID_NOT_FOUND"` 或 `code: "UID_COORDINATES_UNAVAILABLE"`、`recoveryHint` 和
  `nextStepHint`，提示重新 observe 并从 `scrollableContainers[]` 选择 fresh uid，或使用
  document/coordinate fallback；既有成功 scroll、no-movement 和 partialMovement 路径保持兼容。
- P6.2 coordinate scroll 命中/回退诊断已补齐：当传入 `x` / `y` 时，content script 会返回
  `coordinateTarget`、`scrollContainerFound` 和必要时的
  `coordinateScrollFallback: "document"`，让 agent 区分坐标是否真正命中嵌套滚动容器，
  还是回退到 document 滚动。该切片只新增诊断字段，不改变既有 coordinate/document/uid
  scroll 行为。
- P6.2 coordinate scroll document fallback 恢复提示已补齐：当 handler 收到
  `coordinateScrollFallback: "document"` 时，成功结果保持 `ok: true` /
  `recoverable: false`，并新增 `coordinateFallbackHint` 与更明确的 `nextStepHint`，
  指向 `yunti_observe_page` 和 fresh `scrollableContainers[]` uid，避免 agent 误以为
  nested panel 已经被滚动。
- P6.2 wait-observe 恢复指导已补齐：`yunti_get_tool_usage_hints`、Tool Guide 和 skill
  现在明确要求异步渲染、校验、option 加载或新内容加载时，先用 `yunti_wait_for`
  等待预期 text/selector/state，再调用 `yunti_observe_page`，最后用 fresh uid 继续
  fill/select/scroll，而不是复用旧 uid 或盲目重复同一动作。
- P6.2.6 已完成：`yunti_wait_for` 自身现在补齐结构化返回字段，保留既有
  `found`、`text`、`selector`、`condition`、`value`、`waitedMs` 等兼容字段，同时新增
  `action: "wait_for"`、`target`、`ok`、`recoverable`、`nextStepHint`；超时返回
  `code: "WAIT_TIMEOUT"` 和 `recoveryHint`，让等待工具也能自然接入
  `wait -> observe -> fresh uid` 恢复闭环。
- P6.2.6 最新验证：`git diff --check` 通过；token 残留检查无输出；
  `node --test tests/tool-handlers.test.js` 通过 42 个用例；
  `node --test tests/bridge.test.js` 通过 66 个用例；`YUNTI_E2E=1 npm run test:e2e`
  因当前环境缺少 Playwright/Chromium 跳过；`npm run release:check` 通过，覆盖
  116 个 node:test 用例，其中 115 个通过、1 个真实浏览器 smoke 默认跳过，并完成 npm
  package 与 extension zip 内容检查。
- P6.2.7 目标：重新审计结构化 action result 覆盖面，确认
  wait/click/hover/fill/select/scroll/type/press/upload/drag/fill_form 的成功和主要失败路径
  都有可读的 `ok` / `code` / `recoverable` / `nextStepHint`，并整理真实浏览器闭环补验入口。
- P6.2.7 已完成：新增 `docs/ACTION_RESULT_COVERAGE.md` 作为结构化 action result 覆盖矩阵，
  覆盖 click、hover、fill、select、fill_form、wait_for、scroll、type_text、press_key、
  upload_file、drag 共 11 个 action surfaces；新增 `npm run check:action-results` 和
  `scripts/check-action-result-coverage.js`，并接入 `npm run release:check`，避免后续
  上下文压缩或代码变更后忘记维护覆盖状态。
- P6.2.7 最新验证：`npm run check:action-results` 通过，识别 11 行覆盖矩阵；
  `npm run check` 通过；`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 因当前环境缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 116 个 node:test 用例，其中 115 个通过、1 个
  真实浏览器 smoke 默认跳过，并完成 npm package 内容检查 44 个文件和 extension zip
  内容检查 13 个文件。
- 下一步推进顺序：如果当前环境补齐 Playwright/Chromium，先关闭 P6.1.4 真实浏览器
  `observe -> click uid -> observe/verify` 闭环；如果环境仍不可用，则进入 P6.3.1，
  把 agent 默认工作流契约和可复制提示词沉淀成文档、Tool Guide 和 skill 引导。
- P6.3.1 已完成：新增 `docs/AGENT_WORKFLOW_CONTRACT.md`，沉淀默认
  `hints -> list targets -> observe -> act by fresh uid -> wait if needed -> observe -> verify`
  操作循环、恢复规则、危险操作确认边界和可复制提示词；`yunti_get_tool_usage_hints`
  新增 `workflow` topic、`defaultPageOperation`、`confirmationBoundary` 和
  `copyableAgentPrompt`；`docs/TOOL_GUIDE.md` 和 packaged skill 已同步默认页面操作契约。
- P6.3.1 最新验证：`node --test tests/bridge.test.js` 通过 67 个用例；`git diff --check`
  通过；token 残留检查无输出；`YUNTI_E2E=1 npm run test:e2e` 因当前环境缺少
  Playwright/Chromium 跳过；`npm run release:check` 通过，覆盖 117 个 node:test 用例，
  其中 116 个通过、1 个真实浏览器 smoke 默认跳过，并完成 npm package 内容检查 45 个文件和
  extension zip 内容检查 13 个文件。
- 下一步固定为 P6.3.2：在 Tool Guide 和 skill 中补齐最小用例，包括点击、填表、
  滚动找元素、切 tab、等待异步结果，并确保这些用例复用 P6.3.1 默认循环和 P6.2
  结构化结果读取规则。
- P6.3.2 已完成：`docs/TOOL_GUIDE.md` 和 packaged skill 已补齐五个最小用例：
  Click、Fill Form、Scroll To Find、Switch Tab、Wait For Async Result；
  `yunti_get_tool_usage_hints` 的 `workflow` topic 现在返回 `minimalUseCases`，
  包含 `clickByUid`、`fillForm`、`scrollToFind`、`switchTab` 和
  `waitForAsyncResult`，并由 `tests/bridge.test.js` 锁住关键规则。
- P6.3.2 最新验证：`node --test tests/bridge.test.js` 通过 68 个用例；`git diff --check`
  通过；token 残留检查无输出；`YUNTI_E2E=1 npm run test:e2e` 因当前环境缺少
  Playwright/Chromium 跳过；`npm run release:check` 通过，覆盖 118 个 node:test 用例，
  其中 117 个通过、1 个真实浏览器 smoke 默认跳过，并完成 npm package 内容检查 45 个文件和
  extension zip 内容检查 13 个文件。
- P6.4.1 已完成：`extension/dom-observer.js` 的 strict redaction 现在覆盖
  page title、label、name、visible text、placeholder、value preview、select
  selected value/text、options value/text、scrollable container name，以及 email、
  phone、Luhn-valid payment-card-like 和 address-like 文本；balanced 保持 credential-like
  默认保护，`off` 仍仅用于显式本地调试。
- P6.4.1 最新验证：`node --check extension/dom-observer.js` 通过；
  `node --test tests/dom-observer.test.js` 通过 6 个 DOM observer 用例；
  `node --test tests/bridge.test.js` 通过 68 个用例；`git diff --check` 通过；
  token 残留检查无输出；`YUNTI_E2E=1 npm run test:e2e` 因当前环境缺少
  Playwright/Chromium 跳过；`npm run release:check` 通过，覆盖 119 个 node:test
  用例，其中 118 个通过、1 个真实浏览器 smoke 默认跳过，并完成 npm package 内容检查
  45 个文件和 extension zip 内容检查 13 个文件。
- P6.4.2 已完成：`mcp/redaction.js` 的共享文本脱敏覆盖 Bearer、JWT、private key、
  长 token-like、email、phone、Luhn-valid payment-card-like 和 address-like 内容；
  learning memory 的 title/detail/tags/source 写盘前统一脱敏；console diagnostics 的
  text/stack/args 缓存前统一脱敏；raw CDP events 保持明确的低层原始诊断例外，并要求调试后清理。
- P6.4.2 最新验证：`node --check mcp/redaction.js`、`node --check mcp/memory.js` 和
  `node --check mcp/bridge-hub.js` 通过；`node --test tests/bridge.test.js` 通过 70 个用例；
  `git diff --check` 通过；token 残留检查无输出；`npm run check` 通过；`npm test`
  通过，覆盖 121 个 node:test 用例，其中 120 个通过、1 个真实浏览器 smoke 默认跳过；
  `YUNTI_E2E=1 npm run test:e2e` 因当前环境缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，并完成 npm package 内容检查 45 个文件和 extension zip
  内容检查 13 个文件。
- P6.4.3 已完成：`yunti_get_tool_usage_hints` 新增 raw CDP 和 screenshot 专项 guidance；
  `yunti_get_cdp_events` 明确 raw payload、不默认脱敏、优先 sanitized diagnostics、按
  `method` / `limit` 缩小范围，并在调试后用 `yunti_clear_cdp_events` 清理；`yunti_take_screenshot`
  和 `yunti_capture_visible_tab` 明确截图是真实像素、不继承 DOM redaction，优先 viewport
  和安全摘要，不把 raw image data 写入 learning memory。
- P6.4.3 最新验证：`node --check mcp/tools.js` 通过；`node --test tests/bridge.test.js`
  通过 71 个用例，新增 raw CDP / screenshot safety boundary usage hints 覆盖；
  `git diff --check` 通过；token 残留检查无输出；`npm run check` 通过；`npm test`
  通过，覆盖 122 个 node:test 用例，其中 121 个通过、1 个真实浏览器 smoke 默认跳过；
  `YUNTI_E2E=1 npm run test:e2e` 因当前环境缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，并完成 npm package 内容检查 45 个文件和 extension zip
  内容检查 13 个文件。
- P6.1.4 最新验证：使用 `/opt/miniconda3/envs/pytest-playwright` 中已有的 Playwright
  浏览器缓存，临时执行
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save --package-lock=false playwright@1.58.0`
  补齐 Node E2E 依赖；随后 `YUNTI_E2E=1 npm run test:e2e` 通过真实浏览器扩展
  bridge smoke，覆盖 `observe -> click uid -> verify` 闭环。完整门禁也已通过：
  `git diff --check`、token 残留检查、`npm run check`、`npm test`、
  `YUNTI_E2E=1 npm run test:e2e` 和 `npm run release:check`。
- P6.5.1 已完成：bridge 内置可选本地控制台 `/console` 和脱敏状态接口
  `/console/state`；CLI 新增 `yunti-browser-runtime console`；控制台展示连接页面、
  pending/queued runtime 请求、最近工具 activity、network/console/CDP 诊断数量，并提供
  `cancel pending` 操作清理 runtime 仍在等待或排队的请求。控制台保持非必选，不改变 MCP
  工具路径、扩展 popup 零配置路径或首跑安装路径。
- P6.5.1 最新验证：`git diff --check` 通过；token 残留检查无输出；`npm run check`
  通过；`npm test` 通过，覆盖 125 个 node:test 用例，其中 124 个通过、1 个真实浏览器
  smoke 默认跳过；`YUNTI_E2E=1 npm run test:e2e` 通过 1 个真实浏览器 smoke；`npm run
  release:check` 通过，并完成 npm package 内容检查 45 个文件和 extension zip 内容检查 13
  个文件。
- P6.5.2 已完成：控制台支持 `HEAD /console`，`/console/state` 返回 runtime version、
  expected extension version、session extension version 和 warnings；扩展注册 session 时上报
  `client.extensionVersion`；控制台页面展示 runtime/extension 版本与 warning 面板；doctor
  JSON 和 human summary 增加 console URL；空状态指引改为 reload extension、打开/刷新
  http/https 页面再运行 doctor。
- P6.5.2 最新验证：`git diff --check` 通过；token 残留检查无输出；`npm run check`
  通过；`npm test` 通过，覆盖 126 个 node:test 用例，其中 125 个通过、1 个真实浏览器
  smoke 默认跳过；`YUNTI_E2E=1 npm run test:e2e` 通过 1 个真实浏览器 smoke；`npm run
  release:check` 通过，并完成 npm package 内容检查 45 个文件和 extension zip 内容检查 13
  个文件。
- P6.5.3 已完成：`tests/e2e.test.js` 的真实浏览器 smoke 现在会加载扩展、注册真实页面、
  检查 `HEAD /console`、读取 `/console` 页面和 `/console/state`，并验证 runtime version、
  expected extension version、session extension version 都与 package version 一致，且不会出现
  `NO_CONNECTED_PAGES` 或 `EXTENSION_VERSION_MISMATCH` warning。
- P6.5.3 最新验证：`git diff --check` 通过；token 残留检查无输出；`npm run check`
  通过；`npm test` 通过，覆盖 126 个 node:test 用例，其中 125 个通过、1 个真实浏览器
  smoke 默认跳过；`YUNTI_E2E=1 npm run test:e2e` 通过 1 个真实浏览器 smoke；`npm run
  release:check` 通过，并完成 npm package 内容检查 45 个文件和 extension zip 内容检查 13
  个文件。
- P6.6.1 已完成：浏览器扩展分发准备，已沉淀权限/隐私/商店材料清单和当前 manifest
  差距审计，未改权限或上架。
- P6.6.2 已完成：商店权限与隐私文案草案已沉淀为可审核、可复用的
  store-facing 文案。
- P6.6.3 已完成：商店前权限策略决策已沉淀，当前 npm/unpacked 路径保持完整能力；
  当前 broad-permission manifest 不作为默认推荐商店提交版本。
- P6.6.4 已后置到 post-0.2 / store-candidate track，不作为 0.2.0 发布硬门槛。
- 当前固定进入 P7.1：0.2.0 npm/unpacked 发布收口，先完成版本 bump、发布文档更新、
  release gates、真实浏览器 E2E 和 dry-run。

## 压缩上下文恢复锚点

如果上下文被压缩或切换线程，新的 agent 应先读取：

1. `docs/PROJECT_STATUS.md` 顶部的 `Current Phase` 和 `Open Work`。
2. 本文档的 `阶段总览`、`当前 0.2.0 推进快照` 和对应 P6 小节。
3. `docs/NEXT_MAJOR_PLAN.md` 的 `Yunti-First Principle`。

恢复后按以下节奏继续：

1. 只做一个兼容优先的小切片。
2. 先更新 `docs/EXECUTION_PLAN.md` 和 `docs/PROJECT_STATUS.md` 的目标与状态。
3. 如果工具行为、schema、usage hint 或 agent 引导变化，同步更新
   `mcp/tools.js`、`docs/TOOL_GUIDE.md` 和 `skills/yunti-browser-runtime/SKILL.md`。
4. 每个切片保留既有兼容字段，不移除 CDP、截图、network、console、upload、tab control
   等 Yunti 自身能力。
5. 验证后再提交，并记录 skipped E2E 是否只是环境限制。

当前下一步提示词：

```text
继续推进 yunti-browser-runtime 0.2.0。请先读取 docs/PROJECT_STATUS.md、
docs/EXECUTION_PLAN.md 和 docs/NEXT_MAJOR_PLAN.md，只做一个兼容优先的小切片。
当前锚点是 P7.1：0.2.0 npm/unpacked 发布收口。P6.6.1 已完成浏览器扩展分发准备，
包括 manifest 权限审计、商店材料清单和 docs/EXTENSION_DISTRIBUTION.md。P6.6.2 已完成
docs/EXTENSION_STORE_COPY.md，包含商店描述、权限说明、隐私草案、data disclosure
和 reviewer notes。P6.6.3 已完成 docs/EXTENSION_PERMISSION_STRATEGY.md，结论是
npm/unpacked 路径保持完整能力，商店候选版本另行设计 optional host access 和 optional
network diagnostics；P6.6.4 后置到 post-0.2，不阻塞发布。P6.5.1 已完成可选本地控制台最小闭环，
P6.5.2 已完成版本 warning、HEAD /console、doctor console URL 和空状态指引增强，
P6.5.3 已完成控制台真实浏览器 E2E 验收。P6.1.4 真实浏览器 observe -> click uid ->
observe/verify 闭环已补验通过。保留现有兼容字段，必要时更新
mcp/tools.js、docs/TOOL_GUIDE.md、skills/yunti-browser-runtime/SKILL.md、
docs/EXECUTION_PLAN.md 和 docs/PROJECT_STATUS.md，并运行规定门禁。不要把项目改成
Page Agent 克隆，保持 Yunti local-first、MCP-native、真实 Chrome/Edge、
细粒度 yunti_* 工具的特色。
```

## P0.1 bridge token + CORS 收紧

状态：已完成（2026-07-02）

实现摘要：

- bridge owner 模式启动时读取 `YUNTI_BROWSER_BRIDGE_TOKEN`，未设置时生成进程内 token 并打印到 stderr。
- 受保护 HTTP 路由统一校验 `x-yunti-browser-token`，未授权请求返回 401。
- `/health` 未带 token 时只返回有限状态，带 token 时返回 session 明细。
- CORS 默认只回显本地调试来源和浏览器扩展来源；可用
  `YUNTI_BROWSER_BRIDGE_ALLOW_ORIGINS` 覆盖。
- MCP proxy、extension、doctor 都支持使用同一 token 请求 bridge。
- extension popup 增加 bridge URL、bridge token、页面匹配规则设置。
- `npm test` 增加 token 拒绝、授权 health、CORS 来源覆盖测试。

### 背景

当前 bridge 默认监听 `127.0.0.1`，方向正确，但本地 HTTP 服务仍需要更强的默认防护。

主要风险：

- 普通网页可能探测本地端口。
- CORS 如果过宽，可能给非扩展页面留出调用面。
- 后续如果用户误绑到非本地地址，风险会被放大。

### 目标

- bridge 启动时有本地访问 token。
- MCP、extension、doctor 使用同一 token。
- 非授权请求拒绝。
- CORS 默认只允许扩展和本地调试需要的来源。
- 继续保持本地安装简单。

### 设计建议

- 新增环境变量：
  - `YUNTI_BROWSER_BRIDGE_TOKEN`
  - `YUNTI_BROWSER_BRIDGE_ALLOW_ORIGINS`
- 若未设置 token：
  - MCP owner 模式启动时生成一次进程内 token；
  - 输出到 stderr 仅用于调试；
  - extension 侧仍需要能通过本地配置保存 token。
- 请求头建议：
  - `x-yunti-browser-token: <token>`
- 对以下接口强制校验 token：
  - `/sessions`
  - `/sessions/register`
  - `/sessions/activate`
  - `/extension/poll`
  - `/extension/result`
  - `/extension/network-event`
  - `/extension/cdp-event`
  - `/extension/console-event`
  - `/mcp/request`
  - `/mcp/local-tool`
- `/health` 可返回有限信息；带 token 时返回完整信息。

### 验收标准

- `npm test` 增加未带 token 被拒绝的测试。
- extension 注册页面时会带 token。
- MCP proxy/owner 请求会带 token。
- `npm run doctor` 可以检查 token 和 bridge 状态。
- README / SECURITY 更新 token 说明。

## P0.2 session TTL / 心跳 / 快速恢复

状态：已完成（2026-07-02）

实现摘要：

- session 元数据增加 `lastSeenAt`、`lastActivatedAt`、`expiresAt`、`staleReason`。
- extension poll/register 会刷新 session 心跳和过期时间。
- bridge 定时清理过期 session，并同步清理 active session 路由。
- 旧 `browserSessionId` 会快速失败，错误信息包含 stale/disconnected 原因和
  `yunti_list_browser_targets` 恢复建议。
- `yunti_list_browser_targets` 可在同一用户注册新 session 后恢复到新路由。
- `npm test` 增加过期清理、旧 id 快速失败、poll 心跳、list targets 恢复路径测试。

### 背景

`browserSessionId` 是浏览器页面路由核心。当前规则文档已经要求 stale 时调用 `yunti_list_browser_targets` 恢复，但代码层还缺 TTL 和快速过期清理。

### 目标

- 关闭、刷新、扩展重载后的旧 session 快速失效。
- agent 第一次误用旧 `browserSessionId` 时快速失败，并给出恢复建议。
- `yunti_list_browser_targets` 能作为标准恢复入口。

### 设计建议

- session 元数据增加：
  - `lastSeenAt`
  - `lastActivatedAt`
  - `expiresAt`
  - `staleReason`
- extension poll/register 视为心跳。
- bridge 定期清理过期 session。
- 错误信息统一包含：
  - stale/disconnected 原因；
  - 建议调用 `yunti_list_browser_targets`；
  - 不建议继续重试旧 id。

### 验收标准

- 测试覆盖过期 session 被清理。
- 测试覆盖旧 `browserSessionId` 快速失败。
- 测试覆盖 list targets 恢复路径。

## P0.3 browser controller 心跳 / 页面按需注册

状态：已完成（2026-07-14）

实现摘要：

- extension background 注册稳定的 `browser_controller` session，并通过
  controller polling 维持扩展在线状态。
- bridge 将 controller session 与 page session 分离，新增
  `browserControllerByUser`、`browserControllerSessionId`、`controllerCount`、
  `pageSessionCount` 和 `extensionConnected` 状态。
- `yunti_list_browser_targets`、`yunti_list_pages`、`yunti_get_browser_target`、
  `yunti_new_page` 和显式 target/tab CDP 可以通过 controller 路由。
- `yunti_observe_page`、`yunti_click`、`yunti_fill` 等页面内容工具仍要求具体
  page session，避免把 controller 当页面误用。
- controller heartbeat 不会覆盖 active page route，避免后台心跳抢占用户当前页。
- doctor/console 文案区分“扩展控制器在线但暂无页面 session”和“扩展未连接”。

### 背景

`0.2.1` 仍容易出现 bridge 在线但没有检测到带 Yunti 扩展页面的提示，进而让
Agent 要求用户刷新页面。根因是在线检测过度依赖页面 session。更合理的模型是：
扩展背景页先维护浏览器级 controller 心跳，MCP 通过 controller 获取全浏览器
targets；页面 session 只在 observe/click/fill 等页面内容能力需要时按需注册。

### 目标

- 安装扩展后不要求用户刷新页面来证明扩展在线。
- MCP 可以先通过 controller 获取浏览器 targets。
- 页面级工具仍保持 content-script 路径，不因 controller 引入默认 CDP。
- doctor、console、README、skill、usage hints 不再把“没有页面 session”误导成
  “扩展没装好”。

### 验收标准

- 单测覆盖 controller 注册、health 区分页/控制器 session、controller 路由
  `yunti_list_browser_targets`、以及 controller 不抢 active page route。
- `npm run check` 通过。
- `npm test` 通过。
- `npm run release:check` 通过后再发布 `0.2.2`。
- `yunti_get_tool_usage_hints` 和 skill 同步更新。

最新验证：

- `npm run check` 通过。
- `node --test tests/session-manager.test.js tests/bridge.test.js` 通过，82 个
  node:test 用例全过。
- `npm test` 通过，133 个 node:test 用例中 132 个通过，1 个真实浏览器 smoke
  默认跳过。
- `npm run release:check` 通过，包含公开文档/链接检查、version consistency
  `0.2.2`、CLI smoke、doctor smoke、11 行 action-result coverage、npm package
  contents 49 个文件、extension zip contents 13 个文件。
- `YUNTI_E2E=1 npm run test:e2e` 通过，1 个真实浏览器 smoke 用例通过。

## P0.4 单 controller 传输 / 页面 session 稳定恢复

状态：已完成、已提交并随 `0.2.3` 发布（2026-07-18）

线上反馈与实机诊断确认：`0.2.2` 虽然增加了 controller 心跳，但仍让每个 page
session 建立独立的 25 秒 HTTP long poll。多标签页共享
`http://127.0.0.1:48887` 的连接池时，只有少数 poll 能并发，其余请求排队超过 Bridge
的 90 秒 TTL。实机观察到 28 个 page session 在标签页未关闭时下降到 14 个，且
controller 在线时 `yunti_list_browser_targets` 仍可能超时。

实现摘要：

- 扩展只保留一条 `browser_controller` poll，page session 不再启动 poll。
- Bridge 将逻辑页面路由与实际 controller 传输分开；observe/click/fill 仍由
  content script 执行，不切换为默认 CDP。
- controller 心跳携带 `liveTabIds`，只续期真实存在的标签页元数据，并清理已关闭
  tab；新 page session 会替换同用户同 tab 的旧路由。
- page session id 由 controller id + tab id 稳定生成，MV3 worker 重启后同一 tab
  可恢复同一逻辑 id。
- 页面工具支持 page session、`tabId`、`targetId`、可解析 tab 的旧 session id，
  或当前活动页；controller 自动 ping/inject content script 并注册页面。
- `yunti_list_browser_targets` 的页面 `browserSessionId` / `pageSessionId` 未注册时为
  null，`routeBrowserSessionId` 明确表示 controller 传输，不再冒充页面 id。
- Bridge 保留对未声明 `singleControllerTransport` 的旧扩展页面 poll 兼容；升级后未
  reload 的旧扩展会收到明确的版本恢复提示。

验收标准：

- 30 个页面只产生 1 条 controller poll，所有 page session `pollers=0`。
- controller 心跳保持 live-tab 元数据，不让关闭 tab 永久存活。
- 旧 `yunti-<tabId>-...` session、controller-only、无 page session 三种状态都能
  自动执行页面工具。
- target inventory 不返回伪造的页面 session id。
- 完整单测、release check、真实浏览器 E2E 通过；E2E 断言 page poller 为 0、
  inventory page id 正确、旧 session 实际恢复成功。

## P0.5 CDP 一等能力 / 成功率优先的后端选择策略

状态：已完成并通过完整验证（2026-07-17）

决策背景：

`0.2.1` 为避免普通 action 无意 attach debugger，逐步形成了“content script 优先、
CDP 只在必要时使用”的 Agent 指引。该指引保护了无 CDP 操作能力，但也让 Agent 把
CDP 误解为受限或不推荐能力，降低了跨域 iframe、Shadow DOM、Canvas、精确输入、
browser target、网络控制、仿真和复杂页面诊断的成功率。

实现摘要：

- content script 与 CDP 定位为互补的一等后端，Agent 按可达性、可靠性和验证能力选择。
- 不再因为 Chrome debugger banner 或页面可能存在反自动化逻辑而全局回避 CDP；
  banner 仅作为运行状态提示。
- `yunti_cdp_send_command` 的 schema 描述、usage hints、默认工作流、可复制提示词、
  README、Tool Guide、Agent Workflow Contract 和 packaged skill 同步更新。
- 明确 CDP 本身不触发额外用户确认；确认边界由提交、删除、付款、发布、敏感上传等
  操作效果决定。
- 不做 action 失败后的无条件跨后端自动重放。如果写操作可能已经执行但回执不确定，
  Agent 必须先 observe/evaluate/screenshot 验证状态，再决定通过 DOM 或 CDP 重试，避免
  双击、重复提交或重复写入。
- raw CDP events 和截图的敏感数据边界保持不变；这是输出数据安全要求，不是 CDP
  操作能力限制。

验收标准：

- usage hints 明确包含 first-class、proactive CDP、debugger banner 非限制三条规则。
- 默认工作流允许 Agent 在 CDP 能提高成功率时直接切换，不要求额外用户确认。
- recovery guidance 要求不确定的写操作先验证再跨后端重试。
- 文档、skill 与 MCP 运行时提示保持一致，且完整 release check 通过。

## P1.1 doctor 增强

状态：已完成（2026-07-02）

实现摘要：

- `npm run doctor` 检查 Node 版本、bridge 可达性、token 是否配置且有效、session 数、
  active session、是否检测到 extension 注册、MCP server 文件和 skill 文件。
- 输出完整 JSON 到 stdout，方便 agent 读取。
- 同时输出人类可读摘要到 stderr，方便用户排查。
- 常见失败会给出下一步命令或操作建议。
- 新增 `npm run doctor:json`，便于只读取 JSON。

### 目标

把 `npm run doctor` 从简单 health check 升级为安装诊断工具。

### 检查项

- Node 版本。
- bridge 是否可访问。
- token 是否配置/可用。
- 已注册 session 数。
- 当前 active session。
- 是否检测到 extension 页面注册。
- MCP server 文件路径是否存在。
- skills 路径是否存在。

### 验收标准

- 输出 JSON，方便 agent 读取。
- 输出人类可读摘要，方便用户排查。
- 常见失败给出下一步命令。

## P1.2 MCP config printer

状态：已完成（2026-07-02）

实现摘要：

- 新增 `scripts/print-config.js` 和 `npm run print-config`。
- 支持 `--agent codex`、`--agent claude-code`、`--agent cursor`、`--agent cline`。
- 输出包含 MCP server 配置、当前项目绝对路径、`YUNTI_BROWSER_BRIDGE_PORT`、token
  配置说明和 skill 安装路径提示。
- token 只输出占位说明，不把真实 secret 写入生成配置。
- README / INSTALL 使用该命令替代硬编码 MCP 配置。

### 目标

新增命令自动打印不同 Agent 的 MCP 配置，降低安装门槛。

### 建议命令

```bash
npm run print-config
npm run print-config -- --agent codex
npm run print-config -- --agent claude-code
npm run print-config -- --agent cursor
npm run print-config -- --agent cline
```

### 输出内容

- MCP server 配置。
- 当前项目绝对路径。
- `YUNTI_BROWSER_BRIDGE_PORT`。
- 如启用 token，包含 token 配置说明但避免直接把敏感 token 写进公开文档。
- skill 安装路径提示。

### 验收标准

- README 使用该命令替代硬编码本机绝对路径。
- 至少支持 Codex 和 Claude Code 示例。

## P1.3 extension 打包脚本

状态：已完成（2026-07-02）

实现摘要：

- 新增 `scripts/package-extension.js` 和 `npm run package:extension`。
- 输出 `dist/yunti-browser-runtime-extension-<version>.zip`。
- zip 内只包含 `extension/` 运行所需文件，不包含 `.DS_Store`、测试、docs、node_modules。
- README / INSTALL 增加开发加载和 zip 打包说明。

### 目标

提供一键生成 extension zip 的能力。

### 建议命令

```bash
npm run package:extension
```

### 验收标准

- 输出 `dist/yunti-browser-runtime-extension-<version>.zip`。
- zip 内只包含扩展所需文件。
- 不包含 `.DS_Store`、测试、docs、node_modules。
- README 增加开发加载和 zip 安装两种说明。

## P1.4 真实浏览器 E2E smoke test

状态：已完成（2026-07-02）

实现摘要：

- 新增 `tests/e2e.test.js` 和 `npm run test:e2e`。
- 默认跳过，设置 `YUNTI_E2E=1` 后才启动真实浏览器，避免普通 CI / 本地检查被浏览器依赖阻塞。
- E2E 使用 Playwright persistent Chromium profile 加载 unpacked extension。
- 测试会启动本地 bridge 和本地测试页面，并验证 MCP list targets、snapshot、
  selector click/fill、CDP `Runtime.evaluate`。
- 失败时输出临时 artifact 目录，包含 screenshot 和 error log。
- README / INSTALL 增加 E2E 运行说明和跳过策略。

### 背景

当前测试主要覆盖 bridge/MCP 逻辑，还缺真实浏览器、真实扩展消息链路。

### 目标

验证：

- Chromium 加载 extension。
- 页面注册到 bridge。
- MCP 可 list targets。
- MCP 可 snapshot。
- MCP 可 click/fill。
- MCP 可执行 CDP `Runtime.evaluate`。

### 技术建议

- 使用 Playwright 启动 Chromium persistent context。
- 加载 unpacked extension。
- 起一个本地测试页面。
- 起 bridge/MCP 测试进程。

### 验收标准

- 新增 `npm run test:e2e`。
- CI 或本地可跳过，但文档清楚。
- 失败时输出截图/日志位置。

## P2.1 README 和文档开源化

状态：已完成（2026-07-02）

实现摘要：

- README 保留中文主入口，并补充英文摘要。
- README 增加 FAQ，以及权限/隐私说明入口。
- 公开文档统一 npm 命令口径。
- README 命令移除本机绝对路径，可直接复制执行。
- 移除公开文档中的内部参考路径和内部平台名残留。

### 目标

把文档从本地开发说明变成公开项目说明。

### 清理项

- 移除本机绝对路径。
- 移除内部参考路径。
- 中文 README 保留，补英文摘要或英文 README 入口。
- 统一 npm / pnpm 口径。
- 增加常见问题 FAQ。
- 增加“权限说明”和“隐私说明”入口。

### 验收标准

- 公开文档残留检查不出现本机路径或内部平台词。
- README 中所有命令可复制执行。

## P2.2 npm package metadata / bin

状态：已完成（2026-07-02）

实现摘要：

- `package.json` 增加 `bin`、`files`、`repository`、`keywords`、`homepage`、
  `bugs`、`packageManager`。
- 新增 `bin/yunti-browser-runtime.js`，支持 `mcp`、`bridge`、`doctor`、
  `print-config`、`package-extension`。
- `npm pack --dry-run` 可验证发布内容。
- 本地 `npm link` 后可运行 `yunti-browser-runtime --help`。
- README / INSTALL 增加 CLI 使用说明。
- 当前 lockfile 策略：项目没有运行时第三方依赖，暂不提交 lockfile；引入依赖时再提交 npm lockfile。

### 目标

让项目可以以 npm 包形式安装和执行。

### 建议新增

- `bin`
- `files`
- `repository`
- `keywords`
- `homepage`
- `bugs`
- `packageManager`
- lockfile 策略

### 可能命令

```bash
yunti-browser-runtime
yunti-browser-runtime bridge
yunti-browser-runtime doctor
yunti-browser-runtime print-config
yunti-browser-runtime package-extension
```

### 验收标准

- `npm pack --dry-run` 输出内容符合预期。
- 本地 `npm link` 后命令可运行。

## P3.1 大文件拆分与模块化

状态：已完成（2026-07-02）

阶段进展：

- 已将 MCP 工具 schema、工具分组和 `yunti_get_tool_usage_hints` 拆到
  `mcp/tools.js`。
- `mcp/server.js` 重新导出 `TOOLS` 以保持现有测试和外部导入兼容。
- 已将 JSON-RPC 响应封装拆到 `mcp/json-rpc.js`。
- 已将网络/CDP/控制台复用的脱敏、截断和事件规范化逻辑拆到
  `mcp/redaction.js`。
- 已将 learning memory 的本地存储、脱敏和增删查逻辑拆到 `mcp/memory.js`。
- 已将 MCP session hub、请求队列、network/CDP/console 事件缓存和 bridge-local
  tool 路由拆到 `mcp/bridge-hub.js`，`mcp/server.js` 继续重新导出
  `BridgeHub` 以保持测试和外部导入兼容。
- 已将 MCP HTTP bridge server、CORS/token 校验、bridge route handler 和 body
  parser 拆到 `mcp/http-server.js`，`mcp/server.js` 继续重新导出
  `startBridgeServer`、`DEFAULT_HOST`、`DEFAULT_PORT` 和 `BRIDGE_TOKEN_HEADER`。
- 已将 extension 的设置读取、bridge header 和页面匹配逻辑拆到
  `extension/settings.js`。
- 已将 extension 的 webRequest 网络监听、请求体摘要和敏感字段预览脱敏拆到
  `extension/network-monitor.js`。
- 已将 extension 的 CDP target 拦截、attach/detach、trace buffer 和 debugger
  promise 封装拆到 `extension/cdp.js`。
- 已将 extension 的工具分发和页面操作处理器拆到
  `extension/tool-handlers.js`。
- 已将 extension 的 session 注册、poll loop、popup 状态、bridge post 和 console
  event 转发拆到 `extension/session-manager.js`。
- `npm run check` 已纳入 `mcp/tools.js`、`mcp/json-rpc.js`、`mcp/redaction.js`
  和 `mcp/memory.js`、`mcp/bridge-hub.js`、`mcp/http-server.js`，以及 `extension/settings.js`、`extension/network-monitor.js`、
  `extension/cdp.js`、`extension/tool-handlers.js` 和
  `extension/session-manager.js` 语法检查。

### 背景

当前 `mcp/server.js` 和 `extension/background.js` 偏大，维护成本较高。

### 建议拆分

MCP：

- `mcp/server.js`
- `mcp/json-rpc.js`
- `mcp/bridge-hub.js`（已拆出）
- `mcp/tools.js`
- `mcp/memory.js`
- `mcp/redaction.js`
- `mcp/http-server.js`（已拆出）

Extension：

- `extension/background.js`
- `extension/settings.js`
- `extension/session-manager.js`（已拆出）
- `extension/cdp.js`（已拆出）
- `extension/network-monitor.js`
- `extension/tool-handlers.js`（已拆出）

### 验收标准

- 拆分前后测试保持通过。
- 不引入行为变化。
- 每次拆分控制范围，不做混合重构。

验收结果：

- `npm run check` 通过，覆盖新增的 `mcp/http-server.js`、`mcp/bridge-hub.js`、
  `extension/session-manager.js`、`extension/tool-handlers.js` 等模块语法检查。
- `npm test` 通过：58 项测试，57 项通过，1 项真实浏览器 smoke 按配置跳过。
- `npm run test:e2e` 按预期跳过真实浏览器 smoke test。
- `npm run package:extension` 通过，zip 内包含 12 个 extension runtime 文件。
- `npm pack --dry-run` 通过，npm tarball 包含拆分后的 MCP 和 extension 模块。

## P3.2 工具参数校验与错误提示增强

状态：已完成（2026-07-02）

阶段进展：

- 已增强 `yunti_click` / `yunti_hover` 参数组合错误提示，错误信息会指向
  `yunti_take_snapshot`、CSS selector 或坐标工具的正确恢复路径。
- 已为 `yunti_fill` 增加参数校验：要求 `value` 且必须提供 `uid` 或
  `selector`，并明确拒绝 coordinate-only fill。
- 已为 `yunti_close_page` 增加 `tabId` / `targetId` 误用提示，引导 raw target
  关闭走 `yunti_cdp_send_command` + `Target.closeTarget`。
- 已增强 `yunti_cdp_send_command` 的 `method` / `params` 错误提示，并为
  `Target.closeTarget` 缺少 target 的场景给出 `yunti_list_browser_targets`
  恢复建议。
- 已增强 `yunti_forget_learning_memory` 缺少 `id` 或 id 不存在时的恢复提示。
- 已同步 `yunti_get_tool_usage_hints`、`docs/TOOL_GUIDE.md` 和
  `skills/yunti-browser-runtime/SKILL.md` 的常见参数错误说明。
- 已增加 `tests/bridge.test.js` 覆盖 P3.2 usage hints，验证 `yunti_fill`
  和 `yunti_cdp_send_command` 的参数提示会被 MCP 返回。

### 目标

减少 Agent 猜参数、走弯路。

### 重点工具

- `yunti_click`
- `yunti_hover`
- `yunti_fill`
- `yunti_close_page`
- `yunti_cdp_send_command`
- `yunti_forget_learning_memory`

### 验收标准

- 参数组合错误时返回明确修复建议。
- schema 与实际实现一致。
- `yunti_get_tool_usage_hints` 覆盖所有核心工具。
- skill 同步更新常见错误。

验收结果：

- `npm run check` 通过，覆盖 P3.2 涉及的 `extension/tool-handlers.js`、
  `extension/cdp.js`、`mcp/memory.js`、`mcp/tools.js` 等模块语法检查。
- `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器 smoke 按配置跳过。
- `npm run test:e2e` 按预期跳过真实浏览器 smoke test。
- `npm run package:extension` 通过，zip 内包含 12 个 extension runtime 文件。
- `unzip -l dist/yunti-browser-runtime-extension-0.1.0.zip` 确认 zip 内仅包含
  12 个扩展运行文件。
- `npm pack --dry-run` 通过，npm tarball 包含 P3.2 更新后的 docs、skill、
  MCP 和 extension 模块。

## P4.1 发布前文档与权限审查

状态：已完成（2026-07-02）

阶段进展：

- 已复查 README、INSTALL、SECURITY、extension manifest 和 package metadata。
- README 已补充 P3.2 后的参数规则速查，覆盖 click/hover/fill/close/CDP/memory
  常见误用。
- INSTALL 的 Common Recovery 已补充参数错误恢复、`yunti_fill` 定位要求和
  raw tab/target 关闭路径。
- SECURITY 已补充 `storage` 权限用途、广泛 host permissions 的当前理由和
  发布前复审要求。
- package metadata 当前包含 `bin`、`files`、`repository`、`homepage`、`bugs`
  和 keywords；公开发布前仍需按实际仓库最终确认 URL。

### 目标

把发布前用户最容易踩坑的文档入口补齐，并确认权限说明足够透明。

### 验收标准

- README / INSTALL 覆盖 P3.2 后的核心参数规则。
- SECURITY 解释 manifest 中每项权限和 broad host permissions 的原因。
- 公开文档不出现内部路径或内部平台残留。
- npm package dry-run 继续包含更新后的 docs、skill、MCP 和 extension 文件。

验收结果：

- 公开文档残留检查通过：
  `rg "/U[s]ers|d[i]ngguangyi|C[o]deg|x[y]y|y[b]m100" README.md docs skills package.json`
  无输出。
- `npm run check` 通过，P4.1 文档调整未影响 JS 语法检查。
- `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器 smoke 按配置跳过。
- `npm pack --dry-run` 通过，npm tarball 包含更新后的 README、docs、skill、
  MCP 和 extension 文件，共 35 个文件。

## P4.2 Agent 接入示例补全

状态：已完成（2026-07-02）

阶段进展：

- 已在 INSTALL 增加 Codex、Claude Code、Cursor、Cline 的接入示例。
- README 已链接到 INSTALL 的 Agent Examples，并移除“缺少详细接入示例”的未完成项。
- 接入示例统一使用 `npm run print-config -- --agent ... --human`，避免在公开
  文档中写入本机绝对路径。
- 接入示例补充了 skill 安装、bridge token 同步、重启/刷新和 doctor 验证提示。

### 目标

让用户能从公开文档直接完成主流 Agent 的 MCP 接入，而不需要猜配置位置或参数。

### 验收标准

- INSTALL 覆盖 Codex、Claude Code、Cursor、Cline 四类接入示例。
- README 指向详细接入示例，当前未完成项不再包含已完成内容。
- 示例不硬编码本机绝对路径或真实 token。
- 公开文档残留检查、语法检查、测试和 npm pack dry-run 通过。

验收结果：

- 公开文档残留检查通过：
  `rg "/U[s]ers|d[i]ngguangyi|C[o]deg|x[y]y|y[b]m100" README.md docs skills package.json`
  无输出。
- `npm run check` 通过，接入示例文档调整未影响 JS 语法检查。
- `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器 smoke 按配置跳过。
- `npm pack --dry-run` 通过，npm tarball 包含更新后的 README、INSTALL、
  docs、skill、MCP 和 extension 文件，共 35 个文件。

## P4.3 npm 发布 URL 最终确认

状态：已完成（2026-07-02）

阶段进展：

- 已核对 `package.json` 的发布 metadata：
  `repository=git+https://github.com/yunti-ai/yunti-browser-runtime.git`、
  `homepage=https://github.com/yunti-ai/yunti-browser-runtime#readme`、
  `bugs=https://github.com/yunti-ai/yunti-browser-runtime/issues`。
- 已检查 GitHub repository URL：
  `curl -I -L https://github.com/yunti-ai/yunti-browser-runtime` 返回 HTTP 404。
- 已检查 GitHub issues URL：
  `curl -I -L https://github.com/yunti-ai/yunti-browser-runtime/issues` 返回 HTTP 404。
- 已检查 npm registry：
  `npm view yunti-browser-runtime version --json` 返回 E404，说明包名当前未发布或不可见。
- 已收到新的 GitHub SSH 远端：
  `git@github.com:dingguangyi0/yunti-browser-runtime.git`。
- 已通过 `git ls-remote` 确认该 SSH 远端当前账号可访问。
- 已将 `package.json` 发布 metadata 切换到：
  `repository=git+https://github.com/dingguangyi0/yunti-browser-runtime.git`、
  `homepage=https://github.com/dingguangyi0/yunti-browser-runtime#readme`、
  `bugs=https://github.com/dingguangyi0/yunti-browser-runtime/issues`。
- 已修正 `scripts/release-check.js` 的公开文档残留门禁：允许正式公开 GitHub
  owner `dingguangyi0`，继续拦截本机路径和内部残留词。
- 已增强 `scripts/check-package-metadata.js`：repository/homepage/bugs 的 HEAD
  请求遇到 TLS 断连或 5xx 等临时网络失败时会重试，避免 GitHub 瞬时网络抖动误挡发布。
- `scripts/check-package-metadata.js` 会在 homepage 去掉锚点后与 repository URL
  相同时复用 repository 检查结果，避免对同一 GitHub 页面重复发起 HEAD 请求。
- 已执行 `git push -u origin main`，本地 `main` 已跟踪远端
  `origin/main`。
- 已运行 `npm pkg fix`，将 `bin.yunti-browser-runtime` 规范化为
  `bin/yunti-browser-runtime.js`，避免 npm publish dry-run 自动修正 package metadata。
- `npm run check:metadata` 已确认 repository、homepage、bugs URL 均返回 HTTP 200。
- `npm run release:prepublish` 已完整通过。

### 目标

确认 npm 发布 metadata 指向真实公开仓库，避免发布后 npm 页面出现不可访问链接。

### 验收标准

- `repository` 指向真实可访问的公开 GitHub 仓库。
- `homepage` 指向真实可访问的 README 页面。
- `bugs.url` 指向真实可访问的 issue tracker。
- `npm view yunti-browser-runtime` 的 E404 状态被明确接受为首次发布前状态，或根据实际包名调整。

当前结论：

- P4.3 已完成：`package.json` 的 repository/homepage/bugs metadata 指向
  `https://github.com/BoCodeLab/yunti-browser-runtime`，且公开可达。该仓库最初
  发布在 `dingguangyi0` 账号下，现已迁到 `BoCodeLab` 组织，metadata 与
  `origin` 保持一致。
- npm 包名 `yunti-browser-runtime` 当前未发布；作为 `0.1.0` 首次发布状态已被接受。
- 发布前最后保留 `npm publish --dry-run` 和人工发布确认。

发布门禁结果：

- `npm run check:metadata` 通过（2026-07-02T15:47:32.161Z）：
  repository、homepage、bugs URL 均返回 HTTP 200；npm 未发布状态被识别为首次发布可接受。
- `npm run release:prepublish` 通过（metadata checkedAt:
  2026-07-02T15:57:16.352Z）：`npm run check:metadata` 和
  `npm run release:check` 均通过。
- `npm run release:check` 覆盖公开文档残留检查、public Markdown link check
  （11 个 Markdown 文件）、version consistency check、CLI smoke check、
  print-config smoke check、doctor smoke check、`npm run check`、`npm test`、
  npm package contents check 和 extension zip contents check。
- release gate 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。

## P4.4 发布门禁脚本固化

状态：已完成（2026-07-02）

阶段进展：

- 新增 `scripts/release-check.js`，固化公开文档残留检查、`npm run check`、
  `npm test` 和 `npm pack --dry-run`。
- 新增 `npm run release:check`。
- `npm run check` 已纳入 `scripts/release-check.js` 的语法检查。
- README 和 INSTALL 已增加 `npm run release:check` 的发布前门禁说明。

### 目标

把当前手工发布检查固化成一个可重复命令，减少发布前漏跑步骤。

### 验收标准

- `npm run release:check` 可一次性运行公开文档残留检查、语法检查、测试和
  npm dry-run。
- `npm run check` 覆盖新增脚本语法检查。
- README / INSTALL 说明发布前门禁命令。
- `npm run release:check` 通过。

验收结果：

- `npm run release:check` 通过。
- release check 内部公开文档残留检查通过。
- release check 内部 `npm run check` 通过，并覆盖 `scripts/release-check.js`。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- release check 内部 `npm pack --dry-run` 通过，npm tarball 包含新增的
  `scripts/release-check.js`，共 36 个文件。

## P4.5 发布运行手册

状态：已完成（2026-07-02）

阶段进展：

- 新增 `docs/RELEASE.md`，记录发布前外部 URL 确认、release gate、extension
  zip 检查、可选真实浏览器 smoke test、npm publish dry-run 和发布后检查。
- README 文档入口已增加发布运行手册链接。
- 发布运行手册明确：GitHub repository / issues URL 返回 404 时不得发布。

### 目标

把发布动作整理成可执行 checklist，确保 P4.3 外部确认完成后可以直接按步骤发布。

### 验收标准

- `docs/RELEASE.md` 覆盖外部 URL 确认、`npm run release:check`、extension
  zip 检查、可选 E2E、npm publish dry-run 和发布后验证。
- README 链接发布运行手册。
- `npm run release:check` 通过，并确认 `docs/RELEASE.md` 进入 npm tarball。

验收结果：

- `npm run release:check` 通过。
- release check 内部公开文档残留检查通过。
- release check 内部 `npm run check` 通过。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- release check 内部 `npm pack --dry-run` 通过，npm tarball 包含新增的
  `docs/RELEASE.md`，共 37 个文件。

## P4.6 package metadata 检查命令

状态：已完成（2026-07-02）

阶段进展：

- 新增 `scripts/check-package-metadata.js`，检查 `package.json` 中
  `repository`、`homepage`、`bugs.url` 是否公开可达。
- 新增 `npm run check:metadata`，输出 JSON 报告并在 GitHub URL 不可达时返回
  非零退出码。
- `npm run check` 已纳入 `scripts/check-package-metadata.js` 的语法检查。
- `docs/RELEASE.md` 已改用 `npm run check:metadata` 作为 P4.3 外部 URL
  复验命令。
- README 未完成项已补充 `npm run check:metadata` 复查提示。

### 目标

让 P4.3 的外部 URL 确认可重复执行，并在仓库公开后可以一键复验。

### 验收标准

- `npm run check:metadata` 输出 repository/homepage/bugs/npm 状态 JSON。
- 当前 GitHub URL 返回 404 时，`npm run check:metadata` 返回非零退出码并给出
  下一步提示。
- npm 包名 E404 被报告为首次发布可接受状态，而不是阻断项。
- `npm run check` 和 `npm run release:check` 通过。

验收结果：

- `npm run check:metadata` 输出 JSON 报告；当前报告 `ok=false`，并给出创建/公开
  GitHub repository 或更新 package metadata 的下一步提示。
- `npm run check:metadata` 对当前 GitHub URL 不可达状态返回非零退出码，符合
  发布阻断预期。
- `npm run check:metadata` 将 npm E404 报告为首次发布可接受状态。
- `npm run release:check` 通过；内部 `npm run check` 已覆盖
  `scripts/check-package-metadata.js` 语法检查。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- release check 内部 `npm pack --dry-run` 通过，npm tarball 包含新增的
  `scripts/check-package-metadata.js`，共 38 个文件。

## P4.7 prepublish 发布门禁串联

状态：已完成（2026-07-02）

实现摘要：

- 新增 `npm run release:prepublish`，按顺序运行 `npm run check:metadata`
  和 `npm run release:check`。
- `docs/RELEASE.md` 已补充 `release:prepublish` 的使用时机：外部 package
  metadata 预期已公开可达时运行。
- README 已补充 `release:prepublish` 说明，并明确当前 GitHub URL 返回 404
  时该命令按预期失败。
- 当前 P4.3 GitHub URL 未公开时，`release:prepublish` 会停在
  `check:metadata`，避免误进入本地 release gate 和 npm 发布动作。

### 目标

把“metadata 外部确认 + 本地 release gate”串成一个真正发布前命令，减少发布前漏跑外部 URL 确认。

### 验收标准

- `package.json` 暴露 `npm run release:prepublish`。
- `docs/RELEASE.md` 和 README 说明该命令会在当前 P4.3 未确认状态下失败。
- `npm run check` 通过。
- `npm run release:check` 通过。
- `npm run release:prepublish` 当前因 P4.3 GitHub URL 不可达而失败，并输出
  `check:metadata` 的 JSON 阻塞报告。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、`npm run check`、`npm test`
  和 `npm pack --dry-run` 均通过。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- release check 内部 `npm pack --dry-run` 通过，npm tarball 包含
  `scripts/check-package-metadata.js`、`scripts/release-check.js` 和
  `docs/RELEASE.md`，共 38 个文件。
- `npm run release:prepublish` 返回非零退出码，符合当前 P4.3 未完成状态：
  `check:metadata` 报告 repository 404、bugs 404、homepage URL 不可达，
  npm E404 被识别为首次发布可接受状态。
- P4.3 阻塞处理步骤已新增 `docs/PUBLISHING_BLOCKERS.md` 并从 README、
  release runbook、project status 和当前下一步链接。
- 新增阻塞处理文档后，`npm run release:check` 再次通过：公开文档残留检查、
  `npm run check`、`npm test` 和 `npm pack --dry-run` 均通过；npm tarball
  包含 `docs/PUBLISHING_BLOCKERS.md`，共 39 个文件。

## P4.8 npm package 内容门禁

状态：已完成（2026-07-02）

实现摘要：

- `scripts/release-check.js` 不再只运行普通 `npm pack --dry-run`，而是运行
  `npm pack --json --dry-run` 并解析 tarball 文件列表。
- release gate 现在会校验关键运行时、扩展、skill、发布文档和发布脚本是否实际进入
  npm 包。
- 必备清单覆盖 `README.md`、`LICENSE`、`package.json`、CLI 入口、MCP
  bridge 核心模块、extension 核心模块、skill、安装/发布/阻塞文档，以及
  metadata/release check 脚本。

### 目标

把 npm 包内容从“能打包”提升为“关键发布文件都可证明进入 tarball”，避免后续
`package.json.files`、文件重命名或新增发布文档时漏包。

### 验收标准

- `npm run release:check` 会解析 `npm pack --json --dry-run` 输出。
- release gate 在必备文件缺失时返回非零退出码并列出缺失文件。
- release gate 在必备文件完整时输出 package contents check passed。
- `npm run check` 覆盖更新后的 `scripts/release-check.js` 语法检查。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、`npm run check`、
  `npm test` 和新增的 npm package contents check 均通过。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- release check 内部 `npm pack --json --dry-run` 解析成功，必备 npm package
  内容检查通过，共 39 个文件。

## P4.9 extension zip 内容门禁

状态：已完成（2026-07-02）

实现摘要：

- `scripts/release-check.js` 已在 release gate 中运行 `npm run package:extension`。
- release gate 会解析生成的 extension zip 中央目录，不依赖系统 `unzip`。
- extension zip 校验要求 zip 只包含扩展运行文件：
  `background.js`、`cdp.js`、`content.css`、`content.js`、`network-monitor.js`、
  `manifest.json`、`popup.css`、`popup.html`、`popup.js`、
  `session-manager.js`、`settings.js`、`tool-handlers.js`。
- 必备文件缺失或出现额外文件时，release gate 会返回非零退出码并列出问题文件。

### 目标

把浏览器扩展分发包从“手动 unzip 检查”升级为发布门禁自动检查，避免扩展 zip
遗漏运行文件或混入 docs、tests、node_modules、隐藏文件等非运行内容。

### 验收标准

- `npm run release:check` 会自动运行 `npm run package:extension`。
- release gate 会解析 extension zip 的实际文件列表。
- extension zip 在缺失必备文件或包含额外文件时返回非零退出码。
- extension zip 完整且只包含允许文件时输出 extension zip contents check passed。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、`npm run check`、
  `npm test`、npm package contents check 和 extension zip contents check
  均通过。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- release check 内部 `node scripts/package-extension.js` 成功生成扩展 zip，
  extension zip contents check 通过，共 12 个扩展运行文件。

## P4.10 package / extension 版本一致性门禁

状态：已完成（2026-07-02）

实现摘要：

- `scripts/release-check.js` 已新增 version consistency check。
- release gate 会读取 `package.json` 和 `extension/manifest.json`。
- npm package 版本和 browser extension manifest 版本缺失或不一致时，
  release gate 会返回非零退出码并打印两边版本。
- 当前 `package.json` 和 `extension/manifest.json` 版本均为 `0.1.0`。

### 目标

防止 npm 包版本和浏览器扩展版本在发布前漂移，避免用户拿到 npm runtime 与
extension zip 版本不一致的组合。

### 验收标准

- `npm run release:check` 会校验 `package.json.version` 与
  `extension/manifest.json.version`。
- 两边版本一致时输出 version consistency check passed。
- 任一版本缺失或两边不一致时，release gate 返回非零退出码并列出两边版本。
- `npm run check` 覆盖更新后的 `scripts/release-check.js` 语法检查。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、version consistency check、
  `npm run check`、`npm test`、npm package contents check 和 extension zip
  contents check 均通过。
- version consistency check 输出 `0.1.0`，确认 `package.json` 与
  `extension/manifest.json` 版本一致。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- 最终复查中，`npm run release:check` 继续通过：公开文档残留检查、version
  consistency check、`npm run check`、`npm test`、npm package contents check
  和 extension zip contents check 均通过。
- 最终复查中，`npm run check:metadata` 仍返回非零退出码：repository、
  homepage、bugs URL 均返回 404；npm E404 仍被识别为首次发布可接受状态。

## P4.11 npm bin CLI smoke 门禁

状态：已完成（2026-07-02）

实现摘要：

- `scripts/release-check.js` 已新增 CLI smoke check。
- release gate 会校验 `package.json` 中 `bin.yunti-browser-runtime` 指向
  `bin/yunti-browser-runtime.js`。
- release gate 会运行 `node bin/yunti-browser-runtime.js --help`，确认帮助输出包含
  `Yunti Browser Runtime` 和 `package-extension` 命令。
- release gate 会运行 `node bin/yunti-browser-runtime.js --version`，确认输出与
  `package.json.version` 一致。

### 目标

防止 npm 发布包的 CLI 入口、帮助命令或版本命令在发布前漂移，确保用户安装后能
通过 `yunti-browser-runtime --help` 和 `yunti-browser-runtime --version`
完成基本自检。

### 验收标准

- `npm run release:check` 会校验 `package.json` 的 npm bin 映射。
- CLI `--help` 返回 0，并包含主要命令入口。
- CLI `--version` 返回 0，并与 `package.json.version` 一致。
- 任一检查失败时，release gate 返回非零退出码并打印失败细节。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、version consistency check、
  CLI smoke check、`npm run check`、`npm test`、npm package contents check
  和 extension zip contents check 均通过。
- CLI smoke check 输出 `0.1.0`，确认 `bin.yunti-browser-runtime`、`--help`
  和 `--version` 均可用。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。

## P4.12 Agent config smoke 门禁

状态：已完成（2026-07-02）

实现摘要：

- `scripts/release-check.js` 已新增 print-config smoke check。
- release gate 会分别运行 `scripts/print-config.js --agent <agent> --json`，
  覆盖 Codex、Claude Code、Cursor、Cline 四种 Agent 配置输出。
- JSON smoke 会校验 MCP server 名称、`node` 命令、`mcp/server.js` 参数、
  `YUNTI_BROWSER_BRIDGE_PORT`、`YUNTI_BROWSER_BRIDGE_TOKEN` 指引和 skill 路径。
- release gate 还会运行 `scripts/print-config.js --agent codex --human`，
  确认人类可读输出包含配置标题、token 指引和 skill 路径。

### 目标

防止 Agent 接入配置在发布前漂移，确保公开文档推荐的 `print-config` 命令能持续
输出可用的 MCP 配置和 skill 安装提示。

### 验收标准

- `npm run release:check` 会校验 Codex、Claude Code、Cursor、Cline 的 JSON
  配置输出。
- JSON 输出必须包含可用的 `yunti-browser-runtime` MCP server 配置。
- human 输出必须包含配置标题、bridge token 指引和 skill 路径。
- 任一 Agent 配置输出异常时，release gate 返回非零退出码并打印失败细节。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、version consistency check、
  CLI smoke check、print-config smoke check、`npm run check`、`npm test`、
  npm package contents check 和 extension zip contents check 均通过。
- print-config smoke check 覆盖 Codex、Claude Code、Cursor、Cline 四种 Agent
  JSON 输出，并通过 Codex human 输出检查 token 和 skill 指引。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。

## P4.13 doctor JSON smoke 门禁

状态：已完成（2026-07-02）

实现摘要：

- `scripts/release-check.js` 已新增 doctor smoke check。
- release gate 会运行 `scripts/doctor.js` 并解析 stdout JSON。
- doctor smoke 校验 Node 版本检查、MCP server 文件、skill 文件、bridge
  token header、bridge reachability 字段和 next steps 结构。
- doctor smoke 不要求本地 bridge 必须在线；bridge 未启动时只要 JSON 诊断结构正确，
  release gate 仍可通过。

### 目标

防止安装诊断入口在发布前失效，确保用户发布后可以通过 `npm run doctor` 或
CLI doctor 命令拿到可解析的诊断 JSON 和下一步建议。

### 验收标准

- `npm run release:check` 会校验 doctor JSON 输出可解析。
- doctor JSON 必须包含 Node、bridge、MCP server、skill 和 next steps 信息。
- MCP server 与 skill 文件必须存在。
- bridge 未启动不应阻塞 release gate，但必须在 doctor JSON 中体现 reachable 状态。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、version consistency check、
  CLI smoke check、print-config smoke check、doctor smoke check、`npm run check`、
  `npm test`、npm package contents check 和 extension zip contents check 均通过。
- doctor smoke check 输出 bridge not reachable，确认 bridge 离线时仍能返回结构化
  JSON 诊断并通过 release gate。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。

## P4.14 公开文档相对链接门禁

状态：已完成（2026-07-02）

实现摘要：

- `scripts/release-check.js` 已新增 public Markdown link check。
- release gate 会扫描 README、docs、skills 下的 Markdown 文件。
- link check 会忽略代码块、纯锚点、外部 URL 和 mailto 链接。
- 对本地相对链接，release gate 会解析相对路径并确认目标文件存在。

### 目标

防止公开文档中的相对链接在发布前断裂，确保 README、release runbook、状态文档和
skill 文档里的本地跳转都能指向实际文件。

### 验收标准

- `npm run release:check` 会检查公开 Markdown 相对链接。
- 相对链接目标文件缺失时，release gate 返回非零退出码并列出断链来源。
- 外部 URL、邮件链接、纯页面锚点和代码块中的示例文本不会误报。

### 验收记录

- `npm run release:check` 通过：公开文档残留检查、public Markdown link check
  （11 个 Markdown 文件）、version consistency check、CLI smoke check、
  print-config smoke check、doctor smoke check、`npm run check`、`npm test`、
  npm package contents check 和 extension zip contents check 均通过。
- release check 内部 `npm test` 通过：59 项测试，58 项通过，1 项真实浏览器
  smoke 按配置跳过。
- npm package contents check 通过并确认 dry-run tarball 包含 39 个文件；
  extension zip contents check 通过并确认扩展 zip 包含 12 个运行时文件。

## P4.15 npm 官方 registry 发布脚本

状态：已完成（2026-07-02）

实现摘要：

- 新增 `npm run release:dry-run`，先执行 `npm run release:prepublish`，再执行
  `npm publish --dry-run --registry=https://registry.npmjs.org/`。
- 新增 `npm run release:publish`，先执行 `npm run release:prepublish`，再执行
  `npm publish --registry=https://registry.npmjs.org/`。
- README 和 `docs/RELEASE.md` 已改用这两个脚本，避免本机 npm registry mirror
  影响发布预览或正式发布。

### 目标

确保最终 npm 发布明确指向官方 npm registry，而不是开发机当前配置的
`registry.npmmirror.com` 等镜像源。

### 验收标准

- `npm run release:dry-run` 能生成 npm 发布预览。
- dry-run 输出显示发布目标为 `https://registry.npmjs.org/`。
- dry-run tarball 内容仍为预期的 39 个文件。

### 验收记录

- 本机 `npm config get registry` 返回 `https://registry.npmmirror.com`，确认存在
  mirror registry 误发布风险。
- `npm run release:dry-run` 已通过，输出显示
  `Publishing to https://registry.npmjs.org/`。
- npm publish dry-run tarball 包含 39 个文件。

## P4.16 正式发布脚本内置门禁

状态：已完成（2026-07-03）

实现摘要：

- `release:dry-run` 已改为内置执行 `npm run release:prepublish`。
- `release:publish` 已改为内置执行 `npm run release:prepublish` 和
  `npm run release:whoami`。
- README 和 `docs/RELEASE.md` 已移除需要手动先跑 `release:prepublish` 的发布命令序列。

### 目标

避免人工执行 `release:dry-run` 或 `release:publish` 时绕过 metadata 检查、
release gate、npm package 内容检查和 extension zip 内容检查。

### 验收标准

- `package.json` 中 `release:dry-run` 包含 `npm run release:prepublish`。
- `package.json` 中 `release:publish` 包含 `npm run release:prepublish`。
- `package.json` 中 `release:publish` 包含 `npm run release:whoami`。
- `npm run release:dry-run` 会先跑完整 prepublish gate，再生成官方 npm registry
  dry-run 预览。

### 验收记录

- README 和 `docs/RELEASE.md` 已同步为 `npm run release:dry-run` /
  `npm run release:publish` 流程。
- `npm run release:dry-run` 已通过，命令先进入 `npm run release:prepublish`，
  再执行 `npm publish --dry-run --registry=https://registry.npmjs.org/`。
- 内置 prepublish gate 通过：repository、homepage、bugs 均返回 HTTP 200；
  release gate 覆盖公开文档残留、Markdown 链接、版本一致性、CLI smoke、
  print-config smoke、doctor smoke、`npm run check`、`npm test`、npm package
  contents 和 extension zip contents。
- dry-run 输出显示 `Publishing to https://registry.npmjs.org/`，tarball 包含
  39 个文件。

## P4.17 npm 登录预检门禁

状态：已完成（2026-07-03）

实现摘要：

- 新增 `npm run release:whoami`，执行
  `npm whoami --registry=https://registry.npmjs.org/`。
- `npm run release:publish` 已串联 `npm run release:whoami`，在正式发布前先确认
  当前机器已登录官方 npm registry。
- README、`docs/RELEASE.md` 和项目状态已同步 npm 登录预检说明。

### 目标

让正式发布在缺少 npm 登录时以明确、可操作的错误提前停止，而不是进入 publish
流程后才暴露认证问题。

### 验收标准

- `package.json` 中存在 `release:whoami`。
- `release:publish` 在 `npm publish --registry=https://registry.npmjs.org/`
  前执行 `npm run release:whoami`。
- 未登录 npmjs.org 时，`npm run release:whoami` 返回非零退出码并提示登录。

### 验收记录

- 发布前，`npm run release:whoami` 曾在未登录状态返回 `ENEEDAUTH`，验证缺少 npm
  登录时会提前失败。
- 登录后，`npm run release:whoami` 返回 `xuanzhu`，并在正式发布前通过预检。
- `release:publish` 已内置登录预检；登录前不会进入正式 npm publish。

## P4.18 npm 发布后验证命令

状态：已完成（2026-07-03）

实现摘要：

- 新增 `scripts/check-published-package.js`，从官方 npm registry 读取
  `yunti-browser-runtime@0.1.0` 的发布信息。
- 新增 `npm run release:verify-published`，校验已发布包的 name、version、
  repository、homepage、bugs 和 dist tarball URL。
- `npm run check` 已纳入 `scripts/check-published-package.js` 的语法检查。
- `npm run release:check` 的 npm package contents gate 已要求 tarball 包含
  `scripts/check-published-package.js`。
- README、`docs/RELEASE.md` 和项目状态已同步发布后验证命令。

### 目标

把发布后的 `npm view` 人工检查固化为脚本，确保 npm registry 上的实际包版本和
metadata 与当前 `package.json` 一致。

### 验收标准

- `npm run release:verify-published` 会读取官方 npm registry。
- 已发布版本的 name、version、repository、homepage、bugs 和 tarball URL 与当前
  `package.json` 匹配时命令返回 0。
- 当前版本未发布时，命令返回非零退出码并输出结构化 JSON 报告。
- 未发布失败路径不会把 npm 本机 debug log 路径写入 JSON 报告。
- `npm run release:check` 继续通过，且 npm tarball 包含发布后验证脚本。

### 验收记录

- 发布前，`npm run release:verify-published` 曾返回非零退出码并输出结构化未发布报告，
  且失败路径不包含 npm 本机 debug log 路径。
- 发布后，`npm run release:verify-published` 返回 0，确认
  `yunti-browser-runtime@0.1.0` 已发布到 `https://registry.npmjs.org/`。
- `node --check scripts/check-published-package.js` 通过。
- `npm run release:check` 通过：`npm run check` 已覆盖
  `scripts/check-published-package.js`，npm package contents check 确认 tarball
  包含 40 个文件。
- `npm run release:dry-run` 通过：内置 prepublish gate 通过，官方 npm registry
  dry-run tarball 包含 40 个文件。

## P4.19 npm 正式发布执行

状态：已完成（2026-07-03）

执行摘要：

- `npm run release:whoami` 已确认当前官方 npm registry 登录账号为 `xuanzhu`。
- 已按用户确认执行 `npm run release:publish`。
- `release:publish` 已通过内置 `release:prepublish`、`release:whoami` 和全部本地
  发布门禁；本次测试覆盖 59 项，58 项通过，1 项真实浏览器 smoke 按配置跳过。
- 正式发布进入 `npm publish --registry=https://registry.npmjs.org/`，tarball 包含
  40 个文件。
- npm registry 返回 `E403`：当前账号发布包需要双因素认证 OTP，或使用开启
  bypass 2FA 的 granular access token。
- 已使用临时 npm token 重试 `npm run release:publish`；本地发布门禁再次通过，但
  npm registry 仍返回相同 `E403`，说明该 token 不能绕过发布 2FA 要求。
- 已按项目根目录 `.npmrc` 方式写入实际 token 并确认 `.npmrc` 被 `.gitignore`
  忽略；`npm whoami --registry=https://registry.npmjs.org/` 返回 `xuanzhu`，
  但重新执行 `npm run release:publish` 仍在 `npm publish` 阶段返回相同 `E403`。
- 已用新的 npm token 覆盖项目级 `.npmrc` 后再次确认 `npm whoami` 返回 `xuanzhu`；
  `npm run release:publish` 仍通过本地门禁并在 `npm publish` 阶段返回相同 `E403`。
- 已用具备发布权限的 npm token 覆盖项目级 `.npmrc` 后再次执行
  `npm run release:publish`，正式发布成功：`yunti-browser-runtime@0.1.0` 已发布到
  `https://registry.npmjs.org/`。
- `npm run release:verify-published` 通过，确认 registry 上的 name、version、
  repository、homepage、bugs 和 tarball URL 与本地 `package.json` 匹配。

### 目标

完成 `yunti-browser-runtime@0.1.0` 首次 npm 发布，并用已发布包验证命令确认 registry
上的版本和 metadata。

### 验收标准

- 使用当前有效 npm OTP 执行
  `npm run release:publish -- --otp=<6-digit-code>`，或使用具备 publish 权限且允许
  bypass 2FA 的 npm granular access token。
- `npm publish` 返回成功，并显示发布到 `https://registry.npmjs.org/`。
- `npm run release:verify-published` 返回 0，确认已发布包 name、version、
  repository、homepage、bugs 和 tarball URL 与本地 `package.json` 匹配。
- 发布结果同步到 `docs/PROJECT_STATUS.md`。

### 验收记录

- `npm run release:publish` 成功发布 `yunti-browser-runtime@0.1.0`。
- 发布前门禁通过：metadata URL 检查、公开文档残留检查、Markdown 链接检查、版本一致性、
  CLI smoke、print-config smoke、doctor smoke、`npm run check`、`npm test`、npm
  package contents check 和 extension zip contents check。
- `npm test` 覆盖 59 项测试：58 项通过，1 项真实浏览器 smoke 按配置跳过。
- `npm run release:verify-published` 返回 0。
- `npm view yunti-browser-runtime@0.1.0 ... --registry=https://registry.npmjs.org/`
  返回已发布版本和正确 metadata。

## P5.1 本地默认免 bridge token

状态：已完成（2026-07-03）

实现摘要：

- 默认 `127.0.0.1` 本地 bridge 不再自动生成随机 token，也不要求 extension、doctor
  或 MCP proxy 携带 `x-yunti-browser-token`。
- 用户显式设置 `YUNTI_BROWSER_BRIDGE_TOKEN` 时，bridge 继续强制校验
  `x-yunti-browser-token` 或 `Authorization: Bearer <token>`。
- bridge 绑定到非 loopback host 时必须设置 `YUNTI_BROWSER_BRIDGE_TOKEN`，避免把
  本地免 token 默认值误用于远程或局域网部署。
- `npm run doctor` 默认显示 token not required；只有 bridge 明确要求 token 且请求
  未授权时才提示设置 token。
- `npm run print-config` 默认不再要求用户配置 token，仅保留需要加固时的可选说明。
- 真实浏览器 smoke test 改为覆盖默认免 token 路径。
- package 和 extension 版本同步提升到 `0.1.1`。

### 目标

降低本地安装和首次使用心智：用户只需要启动 bridge、加载扩展、确认 bridge URL，
不需要复制或理解 bridge token。安全边界仍保持本地 loopback 默认，显式 token 用于
共享机器、非本地绑定或额外加固场景。

### 验收标准

- 默认 `npm run bridge` 启动的 `127.0.0.1` bridge 不要求 token。
- 未配置 token 时，extension 可以注册页面，doctor 可以读取完整 health。
- 配置 `YUNTI_BROWSER_BRIDGE_TOKEN` 后，未携带 token 的受保护 HTTP route 仍返回 401。
- `YUNTI_BROWSER_BRIDGE_HOST` 绑定非 loopback 地址且未配置 token 时启动失败。
- README、INSTALL、SECURITY、PROJECT_STATUS 同步新的默认使用路径。
- `npm run release:check` 通过。
- `npm run release:publish` 发布 `yunti-browser-runtime@0.1.1`，并通过
  `npm run release:verify-published` 验证。

### 验收记录

- `npm test` 通过：61 项测试，60 项通过，1 项真实浏览器 smoke 按配置跳过。
- 新增测试覆盖本地默认免 token、显式 token 仍强制校验、非 loopback 无 token
  启动失败。
- `npm run check` 通过。
- `npm run release:check` 通过。
- `npm run release:publish` 成功发布 `yunti-browser-runtime@0.1.1`。
- `npm run release:verify-published` 返回 0。

## P5.2 扩展 popup 与安装引导简化

状态：已完成（2026-07-03）

实现摘要：

- 扩展 popup 首屏不再展示 Bridge Token 输入框，避免用户误以为本地默认安装需要填写
  token。
- Bridge Token 移入“高级设置”，并标注为可选；如果用户已有 token 配置，高级设置会
  自动展开。
- popup 默认状态文案改为“默认无需设置，打开或刷新 http/https 页面即可”。
- README 增加“复制给 Agent 的安装引导”，让用户可以把一段话交给 Agent，由 Agent
  分步骤带用户完成 npm 安装、MCP 配置、扩展加载和 doctor 验证。
- README / INSTALL 明确：加载扩展后默认不需要保存设置，不需要 token。
- package 和 extension 版本同步提升到 `0.1.2`。

### 目标

让用户在安装扩展后尽量立即可用：默认无需填写 token、无需保存 popup 设置；需要
自定义 bridge URL、页面匹配或 token 时再进入高级/设置路径。

### 验收标准

- popup 首屏不出现 Bridge Token 输入框。
- popup 仍保留可选 token 配置能力。
- README 包含可复制给 Agent 的安装引导词。
- README / INSTALL 不再要求默认本地安装时点击 popup 保存 token 或保存设置。
- `npm run release:check` 通过。
- `npm run release:publish` 发布 `yunti-browser-runtime@0.1.2`，并通过
  `npm run release:verify-published` 验证。

### 验收记录

- `npm run release:check` 通过。
- `npm run release:publish` 成功发布 `yunti-browser-runtime@0.1.2`。
- `npm run release:verify-published` 返回 0。

## P5.3 扩展首屏零配置

状态：已完成（2026-07-03）

实现摘要：

- 扩展 popup 首屏只保留连接状态和“刷新状态”，不再展示 Bridge URL、页面匹配、
  Bridge Token 或保存按钮。
- Bridge URL、页面匹配和可选 Bridge Token 统一收进“高级设置”；只有检测到用户已
  配置自定义值时才自动展开。
- popup 根据 bridge 健康状态区分“Agent MCP/bridge 未启动”和“刷新页面即可连接”，
  避免把用户引向不必要的设置项。
- README / INSTALL 明确：作为 MCP 接入时，Agent 启动 MCP server 后会自动启动本地
  bridge；`yunti-browser-runtime bridge` 是独立调试路径。
- package 和 extension 版本同步提升到 `0.1.3`。

### 目标

让用户在完成扩展加载后立即进入可用路径：不打开 popup、不填写 token、不保存设置；
除非 doctor 明确提示 bridge 未运行，否则不要求用户单独启动 bridge。

### 验收标准

- popup 首屏没有任何输入框或保存按钮。
- 默认本地安装仍可在刷新 http/https 页面后自动注册 session。
- README 的复制给 Agent 引导不再把独立 `bridge` 当作必选步骤。
- `npm run release:check` 通过。
- `npm run release:publish` 发布 `yunti-browser-runtime@0.1.3`，并通过
  `npm run release:verify-published` 验证。

### 验收记录

- `npm run release:check` 通过。
- `npm run release:publish` 成功发布 `yunti-browser-runtime@0.1.3`。
- 首次 `npm run release:verify-published` 遇到 npm registry 同步延迟；重试后返回 0。
- `npm view yunti-browser-runtime version dist-tags.latest --registry=https://registry.npmjs.org/`
  返回 `0.1.3`。

## P6.0 0.2.0 产品方向护栏

状态：已完成（2026-07-03）

实现摘要：

- 新增 `docs/NEXT_MAJOR_PLAN.md`，作为 `0.2.0 Best Browser Automation Runtime`
  的持久执行契约。
- 明确 `0.2.0` 是 Yunti-first 增强周期，目标是做最好用的本地浏览器自动化操作层，
  而不是克隆某一个参考项目。
- 明确参考范围扩展到 Playwright、Puppeteer、Selenium、CDP、browser-use、Page Agent、
  BrowserGym 和浏览器扩展/本地运行时生态，吸收它们的可靠 action、locator/uid、
  trace/debug、文本 DOM、benchmark fixture、权限透明和安装体验等优点。
- 明确执行顺序：先参考 Page Agent / browser-use，把 P6.1 页面观察和 P6.2 indexed
  action 主线做扎实；其他生态优点后续再分阶段吸收，避免一次性铺太大。
- 明确不吸收的方向：默认不内置 LLM API key、不把细粒度 MCP 工具替换成单一
  `execute_task`、不让 hub tab/side panel 成为必选项、不把远程多用户模式混入本地
  单用户核心。
- 明确必须保留 Yunti 自己的特色：细粒度 MCP 工具、真实 Chrome/Edge 状态、CDP、
  截图、network/console 诊断、tab 控制、本地 bridge 路由和零配置本地安装。
- 将 P6.1-P6.6 写入本执行计划和 `docs/ROADMAP.md`。
- 将 `docs/PROJECT_STATUS.md` 的当前阶段更新为 `0.2.0` 规划状态。

### 多视角审稿结论

已从产品、架构/API、Agent 工作流、安全隐私、测试发布五个视角审阅 `0.2.0` 计划。
共识如下：

- 方向正确：Yunti-first、本地优先、MCP 原生、真实浏览器状态和细粒度工具必须保留。
- 需要把“最好用”变成可验证承诺：更少误点、更少盲目重试、更清晰恢复、更低安装心智。
- P6.1 必须前置最小安全基线，不能等到 P6.4 才处理 DOM observation 脱敏。
- `yunti_observe_page` 需要字段级输入/输出契约、uid 生命周期、错误码和工具兼容矩阵。
- P6.1/P6.2 需要 deterministic fixture，而不是只写能力描述。
- P6.3 的 skill/tool hints 和可复制工作流提示词应在 P6.1 schema 合并时同步更新。

### 目标

避免上下文压缩或线程切换后丢失下一大版本方向，尤其避免因为阅读单一参考项目而偏离
Yunti 自己的特色。后续实现应直接从仓库文档恢复目标、非目标、阶段顺序、验收标准和
下一步。

### 验收标准

- 仓库中存在独立的下一大版本计划文档。
- `ROADMAP`、`PROJECT_STATUS`、`EXECUTION_PLAN` 都指向或记录 `0.2.0` 方向。
- 下一步明确从 P6.1 `yunti_observe_page` 开始。

### 验收记录

- `npm run release:check` 通过；公开文档残留检查、Markdown 相对链接检查、语法检查、
  单测、npm pack 内容检查和 extension zip 内容检查均通过。

## P6.1 Agent 友好的页面观察

状态：实现中（首个 schema / hints / bridge routing 合约切片已落地）

目标：

新增 `yunti_observe_page`，返回适合外部 Agent 使用的页面观察结果：URL/title、页面
尺寸、滚动位置、可交互文本树、稳定 uid、scrollable 容器信息和脱敏元数据。

第一阶段以 Page Agent 的 PageController / browser-state 思路为主要参考，但实现要适配
Yunti 的 MCP/extension/bridge 架构。

### Page Agent 参考审计

当前参考源：`alibaba/page-agent`。

可吸收点：

- `PageController.getBrowserState()`：把 URL/title、页面尺寸、滚动提示和可交互 DOM
  文本合成一个面向 Agent 的观察结果。
- `updateTree()`：把观察刷新与动作执行分开，适合作为 `observe -> act -> verify`
  工作流的前置步骤。
- `selectorMap` 与 simplified HTML：证明 indexed interactive elements 比原始 CSS
  selector 更适合 Agent 使用；Yunti 需要适配成现有 uid 体系。
- `data-scrollable`：对多面板业务系统很重要，应结构化进入 `scrollableContainers`。
- prompt 规则：评估上一步结果、不要盲目重试、只有存在 pixels above/below 时再滚动。

不复制点：

- 不复制内置 LLM loop。
- 不让 hub/sidebar/operator UI 成为必选项。
- 不把 Yunti 收窄为单页任务工具；仍保留 tabs、CDP、network、console、screenshot、
  file upload 和诊断能力。
- 不追求 Page Agent API 兼容；只吸收思路并转成 Yunti 的 MCP 工具契约。

### 文档先行约束

在动功能代码前，先确认以下契约：

- `yunti_observe_page` 是增量增强，不替换或破坏 `yunti_get_page_snapshot` 与
  `yunti_take_snapshot`。
- 第一版优先走 content script DOM collection，使基础页面观察不依赖 CDP attach。
- 输出同时包含结构化字段和紧凑文本树，便于程序消费和 LLM prompt 消费。
- uid 与最新 observation 绑定；uid 过期、缺失或不可见时，错误提示应引导重新调用
  `yunti_observe_page`。
- 默认不返回 password、token-like、credential-like 输入值；完整 DOM 脱敏策略放到
  P6.4 深化。

### 字段级契约草案

输入：

- `browserSessionId`：可选目标浏览器 session。
- `mode`：默认 `viewport`；后续支持有边界的 `fullPage`。
- `maxElements` / `maxTextLength`：默认限量，防止一次返回过多页面内容。
- `includeHidden`：默认 false。
- `includeTextTree` / `includeRects`：默认 true。
- `redaction`：默认 `balanced`；`strict` 用于更强隐私；`off` 仅允许显式本地调试，
  不进入默认 agent workflow。

输出：

- `observationId`、`browserSessionId`、`capturedAt`、`uidMapVersion`。
- `page`：URL、脱敏 URL preview、title、origin、readyState。
- `viewport`：width、height、devicePixelRatio。
- `scroll`：x/y、page size、pixels/pages above/below。
- `elements[]`：`uid`、`role`、`tag`、`name`、`text`、`label`、`placeholder`、
  `valuePreview`、`valueRedacted`、`type`、`hrefPreview`、`rect`、`visible`、
  `disabled`、`editable`、`checked`、`selected`、`scrollable`、`containerUid`。
- `textTree`：面向 Agent 的紧凑文本树。
- `scrollableContainers[]`：`uid`、`tag`、`name`、`rect`、`scrollTop`、
  `scrollHeight`、`clientHeight`、`canScrollVertical`、`canScrollHorizontal`、
  各方向剩余像素。
- `limits`、`redactions`、`hints[]`、`warnings[]`。

uid 生命周期：

- uid 只对当前 `browserSessionId` 的最近一次 observe/snapshot 有效，不承诺跨刷新或跨
  页面永久稳定。
- action 应接受来自 `yunti_observe_page` 或 `yunti_take_snapshot` 的 uid，但错误提示
  必须说明应重新 observe 还是重新 snapshot。
- stale uid 使用结构化错误码，例如 `STALE_OBSERVATION_UID`，并提示重新
  `yunti_observe_page`。
- uid map 只放内存，不写入 learning memory、task history 或长期诊断日志。

最小脱敏基线：

- P6.1 默认 `balanced`，隐藏 password、hidden token、token/secret/auth/cookie/session/
  api-key/credential/otp-like 值、JWT-like、Bearer-like、private-key-like 和长随机串。
- DOM observation 默认使用属性白名单，不返回任意 attributes。
- URL query 默认摘要化或局部脱敏。
- DOM redaction 不代表 screenshot redaction；截图按真实可见像素处理。

受限/降级状态：

- content script 不可用、browser internal page、跨域 iframe 内容省略、session stale、
  tab changed、无可见交互元素、页面仍在 loading、动作验证不确定时，都需要返回
  `hints[]` 或结构化错误。

### 本阶段不做

- 不把 LLM task loop 放进 runtime。
- 不引入必选 hub tab、side panel 或运行时控制台。
- 不做完整 Playwright locator engine。
- 不做大规模 benchmark harness，只做最小 fixture/smoke。
- 不混入 remote multi-user browser orchestration。

### 第一批验收

- 文档确认 `yunti_observe_page` 的输出契约、uid 关系、默认脱敏和第一条 smoke 路径。
- Page Agent 参考审计已沉淀为 Yunti 术语，不再依赖上下文记忆。
- 首个实现切片只添加 MCP schema、`yunti_get_tool_usage_hints` observe-first 指引和
  bridge routing 合约测试；不实现 content script DOM collector，不重写 action layer。
- 后续代码实现再进入 content script collection、uid map 与 action 兼容、最小
  `observe -> click uid -> observe` 闭环、测试和 skill/docs 更新。
- P6.1 完成必须包括 schema 单测、bridge routing 单测、content fixture 单测、真实浏览器
  smoke、skill 更新和 `yunti_get_tool_usage_hints` 更新。

最新切片记录（2026-07-03）：

- `mcp/tools.js` 已新增 `yunti_observe_page` 输入 schema，覆盖 `mode`、`maxElements`、
  `maxTextLength`、`includeHidden`、`includeTextTree`、`includeRects` 和 `redaction`。
- `yunti_get_tool_usage_hints` 已新增 `yunti_observe_page` guidance，并把
  click/hover/fill 的 uid 说明更新为 observe/snapshot fresh uid。
- `tests/bridge.test.js` 已覆盖工具 surface、observe usage hints schema，以及
  `yunti_observe_page` 从 bridge 转发到 extension 的路由合约。
- `extension/dom-observer.js` 已新增 content-script DOM observation MVP，返回 fresh uid、
  compact text tree、viewport/document scroll、scrollable container metadata、balanced
  redaction metadata 和恢复 hints。
- `extension/content.js` 已接入 `yunti_observe_page`，`extension/manifest.json` 和
  extension/package release gates 已纳入 `dom-observer.js`。
- `tests/dom-observer.test.js` 已覆盖基础 DOM 观察、fresh uid、textTree、balanced
  redaction、URL query 脱敏和 scroll metadata。
- `tests/e2e.test.js` 已把 `yunti_observe_page` 加入 opt-in real-browser smoke。
- 最新验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖 70 个
  node:test 用例，其中 69 个通过、1 个 real-browser smoke 按默认配置跳过；
  `YUNTI_E2E=1 npm run test:e2e` 在当前环境因缺少 Playwright/Chromium 被跳过。
- `extension/tool-handlers.js` 已把 `yunti_observe_page` 返回的 elements 写入最新页面
  uid map，`yunti_click` / `yunti_hover` / `yunti_fill` 继续通过现有 uid resolver 使用
  fresh observe uid，同时保留 `yunti_take_snapshot` 兼容路径。
- `tests/tool-handlers.test.js` 已覆盖 `observe -> click uid` 的 background dispatcher
  最小闭环，以及 missing uid 时提示重新 observe/snapshot。
- `tests/tool-handlers.test.js` 也已覆盖最新 observation 替换旧 uid map：第二次 observe
  后旧 uid 会失败并提示重新 observe/snapshot，新 uid 可以继续驱动现有 click 路径。
- `tests/dom-observer.test.js` 已覆盖 hidden/offscreen targets：默认 viewport observe 会
  排除隐藏和视口外元素，`fullPage` 可包含视口外元素，显式 `includeHidden` 才包含隐藏元素。
- `tests/dom-observer.test.js` 已覆盖 redaction edge modes：balanced 会遮蔽 Bearer、
  token-like、URL query secret 和长随机串，strict 会进一步遮蔽较长普通值，`off` 会返回
  原值并带本地调试 warning。
- `tests/e2e.test.js` 的 opt-in real-browser smoke 已改为先 observe，再用 observe uid
  执行 click；本切片不重写 fill/select/scroll action layer。

P6.1 真实浏览器闭环验证 runbook：

- 验证目标：在真实 Chromium + unpacked extension 环境中跑通
  `observe -> click uid -> observe/verify`，证明 content script observe 生成的 fresh uid
  能驱动现有 `yunti_click` 路径，并且点击后的页面状态可以被后续读取验证。
- 环境准备：安装 Playwright npm 依赖和 Chromium 浏览器二进制；如果本地只安装了项目依赖但
  缺少浏览器二进制，应先执行 Playwright 的 Chromium 安装命令，再运行本 smoke。
- 执行命令：`YUNTI_E2E=1 npm run test:e2e`。
- 当前 smoke 行为：测试会启动本地 bridge、加载 unpacked extension、打开本地 fixture 页面、
  调用 `yunti_observe_page` 找到 "Click me" fresh uid、用该 uid 调用 `yunti_click`，
  再通过页面读回确认点击计数和填充值。
- 成功判定：`real browser extension bridge smoke` 不再 skip，测试通过，并且 artifact
  目录没有 failure screenshot 或 error log。
- 环境缺口判定：如果输出 `install Playwright and Chromium before running
  YUNTI_E2E=1 npm run test:e2e`，该结果只说明当前机器缺少真实浏览器验证依赖，不代表
  P6.1 runtime 逻辑失败；在进入 P6.2 前应重新补跑或明确记录为环境限制。
- 失败恢复：优先查看测试输出的 artifact 目录、`failure.png` 和 `error.log`；再确认 extension
  是否加载、bridge URL 是否写入 extension storage、页面是否刷新注册、以及
  `yunti_list_browser_targets` 是否能看到测试页面。

详细范围、非目标和验收标准见 `docs/NEXT_MAJOR_PLAN.md`。

## P6.2 稳定 DOM action 层

状态：进行中（2026-07-03）

目标：

抽取并增强 DOM action 层，提高 click、hover、fill、select、contenteditable、scroll
容器操作的稳定性，让动作结果更容易被 Agent 验证和恢复。

第一阶段优先参考 Page Agent 的 click/input/select/scroll 事件序列；Playwright/CDP 风格
的 auto-wait、trace 和更深诊断后续再逐步补。

### Page Agent 参考审计

可吸收点：

- `clickElement()` 的 pointer/mouse/focus/click 顺序。
- `inputTextElement()` 对 input、textarea、contenteditable 的分支和插入后验证思路。
- `selectOptionElement()` 的 visible text 选择思路。
- `scrollVertically()` / `scrollHorizontally()` 的容器优先滚动、边界判断和结果消息。

不复制点：

- 不引入隐藏细粒度工具的大型 action runner。
- 不移除 selector、coordinate、CDP fallback。
- 不把动作结果只做自然语言字符串；Yunti 应返回结构化结果，必要时附带人类可读 hint。

### 文档先行约束

- 保持现有 `yunti_click`、`yunti_hover`、`yunti_fill`、`yunti_select`、
  `yunti_type_text`、`yunti_press_key`、`yunti_scroll` 工具名稳定。
- 让 uid action 自然衔接 P6.1 `yunti_observe_page`。
- 错误提示要帮助 Agent 判断下一步是重新 observe、scroll、wait、switch tab，还是使用
  selector/coordinate fallback。
- 保留 CDP、selector 和 coordinate fallback，不把动作层收窄成 page-only abstraction。

### 本阶段不做

- 不引入隐藏细粒度工具的大型 action runner。
- 不要求用户打开 mandatory replay/trace UI。
- 不移除现有 CDP fallback 能力。

### 动作优先级与结果契约

动作优先级：

- P0：`observe -> click uid -> observe`。
- P0：`observe -> fill uid -> verify value`，覆盖 input、textarea、contenteditable。
- P0：页面滚动与 container 滚动恢复。
- P1：select visible text/value、tab 选择/切换、新 tab 续接、等待与验证模板。
- P2：把 console/network/screenshot/CDP 诊断接入“为什么没成功”的恢复建议。

动作结果至少包含：

- 当前兼容返回可以继续保留 `clicked`、`hovered`、`filled`、`selected`、`scrolled`、
  `uid`、`selector`、`x/y`、`method`、`valueLength`、`before/after`、
  `browserSessionId` 等现有字段。
- P6.2 目标结构以增量方式收敛到：`action`、`browserSessionId`、`target`、`ok`、
  `code`、`recoverable`、`nextStepHint`。
- `target` 应能表达 uid、selector、coordinate 或 scroll container，不强迫单一路径。
- 必要时包含 before/after 摘要，例如 scroll position、value length、selected option、
  URL/title 变化、toast/dialog 状态。
- 迁移期间不移除现有成功布尔值或 selector/coordinate 字段，避免破坏外部 Agent 和旧 workflow。

`yunti_select` 兼容缺口：

- 当前 selector/value 路径保留。
- P6.2 已增加 `uid + value` runtime 路径，并写明如何与 `yunti_observe_page` 的 uid
  衔接。
- P6.2 已增加 `uid + visible text` runtime 路径；Agent 可以在 fresh uid 下传 `text`，
  但 selector 路径仍保持 selector/value 兼容，不支持 selector/text。

最新切片记录（2026-07-03）：

- `yunti_get_tool_usage_hints` 已新增 P6.2 前置 action recovery guidance，不改写实际
  action layer。
- `yunti_click` / `yunti_hover` / `yunti_fill` hints 现在明确失败或无页面变化后应先
  observe/verify，再根据情况 scroll、wait、switch tab、使用 selector/coordinate fallback
  或询问用户，避免盲目重复同一动作。
- `tests/bridge.test.js` 已覆盖 action recovery guidance，确保 fresh uid、stale/missing
  uid、滚动、等待、tab 切换和 fallback 的恢复提示不会退化。
- 最新验证：`git diff --check` 通过；`node --test tests/bridge.test.js` 通过 63 项；
  `npm run release:check` 通过，覆盖 71 个 node:test 用例，其中 70 个通过、1 个
  real-browser smoke 按默认配置跳过；`YUNTI_E2E=1 npm run test:e2e` 在当前环境因缺少
  Playwright/Chromium 被跳过；token 残留检查无输出。
- `yunti_get_tool_usage_hints` 已新增 action result contract guidance，明确当前 action
  返回是 compatibility-shaped，P6.2 后续只能增量收敛到结构化 `action` / `target` /
  `ok` / `code` / `recoverable` / `nextStepHint` / before-after 摘要，不能破坏现有
  `clicked` / `filled` / `hovered` / selector / coordinate 返回字段。
- 最新验证：`git diff --check` 通过；`node --test tests/bridge.test.js` 通过 64 项；
  `npm run release:check` 通过，覆盖 72 个 node:test 用例，其中 71 个通过、1 个
  real-browser smoke 按默认配置跳过；`YUNTI_E2E=1 npm run test:e2e` 在当前环境因缺少
  Playwright/Chromium 被跳过；token 残留检查无输出。
- `tests/tool-handlers.test.js` 已新增 dispatcher action result shape 测试，锁定当前
  uid click、uid hover、uid fill 和 content-script scroll passthrough 的兼容返回字段，
  作为后续增量加入结构化 `action` / `target` / `ok` / `nextStepHint` 字段前的回归保护。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 4 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 73 个 node:test 用例，其中 72 个
  通过、1 个 real-browser smoke 按默认配置跳过；`YUNTI_E2E=1 npm run test:e2e` 在当前
  环境因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 uid-based `yunti_click` 结果增量追加结构化字段：
  `action: "click"`、`target`、`ok`、`recoverable`、`nextStepHint`，同时保留
  `clicked`、`uid`、`x/y`、`browserSessionId` 兼容字段。
- `tests/tool-handlers.test.js` 已更新 uid click 断言，确保结构化字段不会替代或破坏
  既有兼容返回。
- 最新验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js` 通过 4 项；
  `npm run release:check` 通过，覆盖 73 个 node:test 用例，其中 72 个通过、1 个
  real-browser smoke 按默认配置跳过；`YUNTI_E2E=1 npm run test:e2e` 在当前环境因缺少
  Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 uid-based `yunti_hover` 结果增量追加结构化字段：
  `action: "hover"`、`target`、`ok`、`recoverable`、`nextStepHint`，同时保留
  `hovered`、`uid`、`x/y`、`browserSessionId` 兼容字段。
- `tests/tool-handlers.test.js` 已更新 uid hover 断言，确保结构化字段不会替代或破坏
  既有兼容返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 4 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 73 个 node:test 用例，其中 72 个
  通过、1 个 real-browser smoke 按默认配置跳过；`YUNTI_E2E=1 npm run test:e2e` 在当前
  环境因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 uid-based `yunti_fill` keyboard path 结果增量追加
  结构化字段：`action: "fill"`、`target`、`ok`、`recoverable`、`nextStepHint`，同时保留
  `filled`、`uid`、`method`、`value`、`browserSessionId` 兼容字段；本切片不改
  select/contenteditable/scroll 语义。
- `tests/tool-handlers.test.js` 已更新 uid fill keyboard path 断言，确保结构化字段不会替代或
  破坏既有兼容返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 4 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 73 个 node:test 用例，其中 72 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 uid-based `yunti_fill` select path 结果增量追加
  结构化字段：`action: "fill"`、`target`、`ok`、`recoverable`、`nextStepHint`，同时保留
  `filled`、`uid`、`method: "select"`、`value`、`browserSessionId` 兼容字段；本切片不改
  select 赋值、change/input 事件派发或 keyboard/contenteditable/scroll 语义。
- `tests/tool-handlers.test.js` 已新增 uid fill select path 断言，确保结构化字段不会替代或
  破坏既有 select 兼容返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 5 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 74 个 node:test 用例，其中 73 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 coordinate fallback `yunti_click` 结果增量追加
  结构化字段：`action: "click"`、`target`、`ok`、`recoverable`、`nextStepHint`，同时保留
  `clicked`、`x/y`、`method: "coordinate"`、`browserSessionId` 兼容字段；本切片不改坐标点击
  的 CDP mouse event 派发语义。
- `tests/tool-handlers.test.js` 已新增 coordinate click 断言，确保结构化字段不会替代或
  破坏既有 coordinate fallback 兼容返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 6 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 75 个 node:test 用例，其中 74 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 coordinate fallback `yunti_hover` 结果增量追加
  结构化字段：`action: "hover"`、`target`、`ok`、`recoverable`、`nextStepHint`，同时保留
  `hovered`、`x/y`、`method: "coordinate"`、`browserSessionId` 兼容字段；本切片不改坐标 hover
  的 CDP mouse move 派发语义。
- `tests/tool-handlers.test.js` 已新增 coordinate hover 断言，确保结构化字段不会替代或
  破坏既有 coordinate fallback 兼容返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 7 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 76 个 node:test 用例，其中 75 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 selector fallback `yunti_hover` 结果增量追加
  结构化字段：`action: "hover"`、`target`、`ok`、`recoverable`、`nextStepHint`，同时保留
  `hovered`、`selector`、`x/y`、`method: "selector"`、`browserSessionId` 兼容字段；本切片不改
  selector 定位、scrollIntoView 或 CDP mouse move 派发语义。
- `tests/tool-handlers.test.js` 已新增 selector hover 断言，确保结构化字段不会替代或
  破坏既有 selector fallback 兼容返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 8 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 77 个 node:test 用例，其中 76 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 selector fallback `yunti_click` content-script passthrough
  结果增量追加结构化字段：`action: "click"`、`target`、`ok`、`recoverable`、`nextStepHint`，
  同时保留 content-script 返回的 `clicked`、`element` 字段，并追加 `selector`、
  `method: "selector"`、`browserSessionId` 兼容字段；本切片不改 content-script click
  的 `scrollIntoView`、`element.click()` 或失败返回语义。
- `tests/tool-handlers.test.js` 已新增 selector click passthrough 断言，确保结构化字段不会替代或
  破坏既有 content-script selector click 返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 9 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 78 个 node:test 用例，其中 77 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 `yunti_scroll` content-script passthrough 结果增量追加
  结构化字段：`action: "scroll"`、`ok`、`recoverable`、`nextStepHint` 和
  `browserSessionId`，同时保留 content-script 返回的 `scrolled`、`deltaX/Y`、`target`、
  `before/after` 兼容字段；本切片不改 document/container 滚动选择、坐标命中或
  `scrollBy` 派发语义。
- `tests/tool-handlers.test.js` 已更新 scroll passthrough 断言，确保结构化字段不会替代或
  破坏既有 scroll 返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 9 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 78 个 node:test 用例，其中 77 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 selector fallback `yunti_fill` content-script passthrough
  结果增量追加结构化字段：`action: "fill"`、`target`、`ok`、`recoverable`、
  `nextStepHint`、`selector`、`method: "selector"` 和 `browserSessionId`，同时保留
  content-script 返回的 `filled`、`element`、`valueLength` 兼容字段；本切片不改
  content-script fill 的 `scrollIntoView`、`setEditableText`、input/change 事件或
  contenteditable 处理语义。
- `tests/tool-handlers.test.js` 已新增 selector fill passthrough 断言，确保结构化字段不会替代或
  破坏既有 content-script selector fill 返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 10 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 79 个 node:test 用例，其中 78 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 `yunti_type_text` uid path 和 content-script
  passthrough 结果增量追加结构化字段：`action: "type_text"`、`target`、`ok`、
  `recoverable`、`nextStepHint` 和 `browserSessionId`，同时保留 uid path 的 `typed`、
  `uid`、`text`、`method` 兼容字段，以及 content-script 返回的 `typed`、`element`、
  `textLength`、`mode` 兼容字段；本切片不改 CDP keyboard 派发、selector/coordinate/focused
  fallback 或 content-script `setEditableText` 语义。
- `tests/tool-handlers.test.js` 已新增 uid type_text 和 selector type_text 断言，确保结构化字段
  不会替代或破坏既有 type_text 返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 12 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 81 个 node:test 用例，其中 80 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 `yunti_press_key` uid path 和 content-script
  passthrough 结果增量追加结构化字段：`action: "press_key"`、`target`、`ok`、
  `recoverable`、`nextStepHint` 和 `browserSessionId`，同时保留 uid path 的 `pressed`、
  `uid`、`key` 兼容字段，以及 content-script 返回的 `pressed`、`key`、`element`、
  `valueChanged` 兼容字段；本切片不改 CDP keyDown/keyUp 派发、selector/coordinate/focused
  fallback 或 content-script key event 语义。
- `tests/tool-handlers.test.js` 已新增 uid press_key 和 selector press_key 断言，确保结构化字段
  不会替代或破坏既有 press_key 返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 14 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 83 个 node:test 用例，其中 82 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 `yunti_upload_file` uid path 和 selector path
  结果增量追加结构化字段：`action: "upload_file"`、`target`、`ok`、`recoverable`、
  `nextStepHint` 和 `browserSessionId`，同时保留 `uploaded`、`fileCount`、`filePaths`
  兼容字段；本切片不改 `DOM.getNodeForLocation`、`DOM.querySelector`、`DOM.describeNode`
  或 `DOM.setFileInputFiles` 上传语义。
- `tests/tool-handlers.test.js` 已新增 uid upload_file 和 selector upload_file 断言，确保结构化
  字段不会替代或破坏既有 upload 返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 16 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 85 个 node:test 用例，其中 84 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 coordinate `yunti_drag` 结果增量追加结构化字段：
  `action: "drag"`、`target`、`ok`、`recoverable`、`nextStepHint` 和
  `browserSessionId`，同时保留 `dragged`、`from`、`to`、`steps` 兼容字段；本切片不改
  CDP `Input.dispatchMouseEvent` 的 mousePressed / mouseMoved / mouseReleased 派发语义。
- `tests/tool-handlers.test.js` 已新增 coordinate drag 断言，确保结构化字段不会替代或破坏
  既有 drag 返回，并锁定 mouse event 序列。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 17 项。
- 最新完整验证：`npm run release:check` 通过，覆盖 86 个 node:test 用例，其中 85 个
  通过、1 个 real-browser smoke 按默认配置跳过；extension zip 内容检查通过，包含 13 个文件；
  npm package 内容检查通过，包含 42 个文件；`YUNTI_E2E=1 npm run test:e2e` 在当前环境
  因缺少 Playwright/Chromium 被跳过；token 残留检查无输出。

### Action result 覆盖清单（2026-07-03）

已完成结构化字段的 action paths：

- `yunti_click`：uid path、coordinate fallback、selector passthrough；保留 `clicked`、
  `uid`、`selector`、`x/y`、`method`、`element` 等兼容字段。
- `yunti_hover`：uid path、coordinate fallback、selector fallback；保留 `hovered`、
  `uid`、`selector`、`x/y`、`method` 等兼容字段。
- `yunti_fill`：uid keyboard path、uid select path、selector passthrough；保留 `filled`、
  `uid`、`selector`、`method`、`value`、`valueLength`、`element` 等兼容字段。
- `yunti_scroll`：content-script passthrough；保留 `scrolled`、`deltaX/Y`、`target`、
  `before/after` 等兼容字段。注意 scroll 原有 `target` 是兼容字段，结构化字段只增量补
  `action`、`ok`、`recoverable`、`nextStepHint`、`browserSessionId`。
- `yunti_type_text`：uid CDP keyboard path、selector passthrough；保留 `typed`、`uid`、
  `text`、`method`、`element`、`textLength`、`mode` 等兼容字段。
- `yunti_press_key`：uid CDP keyboard path、selector passthrough；保留 `pressed`、`uid`、
  `key`、`element`、`valueChanged` 等兼容字段。
- `yunti_upload_file`：uid path、selector path；保留 `uploaded`、`fileCount`、`filePaths`
  等兼容字段。
- `yunti_drag`：coordinate path；保留 `dragged`、`from`、`to`、`steps` 等兼容字段。
- `yunti_select`：standalone content-script passthrough；保留 `selected`、`element`、
  `value` 等兼容字段。
- `yunti_select`：uid/value 和 uid/text runtime paths；保留 `selected`、`uid`、
  `value`、`text`、`selectedIndex` 等兼容字段，同时保留 selector/value 兼容路径。
- `yunti_fill_form`：aggregate summary；保留 `filled`、`failed`、`results`、
  `browserSessionId` 等兼容字段。

本覆盖清单确认 P6.2 action result 第一阶段已覆盖主要 action surfaces，并且 `yunti_select`
已完成 selector/value、uid/value、uid/text 三条操作路径；后续可以进入更深的
fill/select/scroll 语义增强，但仍必须小切片推进，并保留兼容字段与 CDP fallback。

最新验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖 86 个
node:test 用例，其中 85 个通过、1 个 real-browser smoke 按默认配置跳过；extension zip
内容检查通过，包含 13 个文件；npm package 内容检查通过，包含 42 个文件；本切片只更新
文档和 skill，不涉及真实浏览器行为，未额外运行 `YUNTI_E2E=1 npm run test:e2e`；token
残留检查无输出。

- `extension/tool-handlers.js` 已为 standalone `yunti_select` content-script passthrough
  结果增量追加结构化字段：`action: "select"`、`target`、`ok`、`recoverable`、
  `nextStepHint` 和 `browserSessionId`，同时保留 `selected`、`element`、`value`
  兼容字段；本切片不改 content-script `selectElement` 的 value 设置或 input/change 事件
  派发语义。
- `tests/tool-handlers.test.js` 已新增 selector select 断言，确保结构化字段不会替代或破坏
  既有 standalone select 返回。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 18 项。
- 最新 full 验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖 87 个
  node:test 用例，其中 86 个通过、1 个 real-browser smoke 按默认配置跳过；extension zip
  内容检查通过，包含 13 个文件；npm package 内容检查通过，包含 42 个文件；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token
  残留检查无输出。
- `extension/tool-handlers.js` 已为 aggregate `yunti_fill_form` summary 增量追加
  结构化字段：`action: "fill_form"`、`target`、`ok`、`recoverable`、`nextStepHint`
  和 `browserSessionId`，同时保留 `filled`、`failed`、`results` 兼容字段；本切片不改
  逐字段 `fillByUid` 或 content-script selector fill 语义。
- `tests/tool-handlers.test.js` 已新增部分成功/部分失败的 fill_form aggregate 断言，确保
  结构化字段不会替代或破坏既有 aggregate summary 与 per-field results。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js`
  通过 19 项。
- 最新 full 验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖 88 个
  node:test 用例，其中 87 个通过、1 个 real-browser smoke 按默认配置跳过；extension zip
  内容检查通过，包含 13 个文件；npm package 内容检查通过，包含 42 个文件；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token
  残留检查无输出。
- `mcp/tools.js` 已为 `yunti_select` 增加 P6.2 uid / visible text 前置契约：schema
  继续要求当前 runtime 真实支持的 `selector` / `value`，并暴露 planned `uid` 和 `text`
  参数说明；usage hints 明确当前 runtime 仍保持 selector/value 兼容路径，并记录 observe、
  inspect options、wait、switch tab 的恢复路径；本切片不改 extension runtime 行为。
- `tests/bridge.test.js` 已新增 `yunti_select` usage hints 断言，锁住 selector/value
  兼容边界、planned uid/text 参数和可用选项检查提示。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/bridge.test.js`
  通过 65 项。
- 最新 full 验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖 89 个
  node:test 用例，其中 88 个通过、1 个 real-browser smoke 按默认配置跳过；extension zip
  内容检查通过，包含 13 个文件；npm package 内容检查通过，包含 42 个文件；本切片只更新
  schema、usage hints、文档和 skill，不改真实浏览器 runtime 行为，未额外运行
  `YUNTI_E2E=1 npm run test:e2e`；token 残留检查无输出。
- `extension/tool-handlers.js` 已为 `yunti_select` 增加 `uid + value` runtime path：
  复用当前 `browserSessionId` 最新 observe/snapshot uid map 定位元素，只按 option
  `value` 匹配并派发 `change` / `input` 事件；selector/value 兼容路径保持不变，本切片
  不实现 visible text 选择。
- `mcp/tools.js`、`docs/TOOL_GUIDE.md` 和 `skills/yunti-browser-runtime/SKILL.md`
  已同步为 selector/value 与 uid/value 均可用，visible option `text` 仍为计划中能力。
- `tests/tool-handlers.test.js` 已新增 uid select value path 断言，确保结果保留
  `selected`、`uid`、`value`、`selectedIndex` 等兼容字段并追加结构化 action result。
- `tests/bridge.test.js` 已更新 select usage hints 断言，锁住 schema 的 selector 或 uid
  二选一路径，以及 visible text 仍 planned 的边界。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 85 项。
- 最新 full 验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖 90 个
  node:test 用例，其中 89 个通过、1 个 real-browser smoke 按默认配置跳过；extension zip
  内容检查通过，包含 13 个文件；npm package 内容检查通过，包含 42 个文件；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token
  残留检查无输出。
- `extension/tool-handlers.js` 已为 `yunti_select` 增加 `uid + visible text` runtime path：
  复用 fresh uid 定位 select，通过 option 可见文本精确匹配并派发 `change` / `input`
  事件；selector/value 和 uid/value 路径保持不变。
- `mcp/tools.js`、`docs/TOOL_GUIDE.md` 和 `skills/yunti-browser-runtime/SKILL.md`
  已同步为 selector/value、uid/value、uid/text 三条路径均可用，同时明确 selector
  路径仍保持 selector/value 兼容。
- `tests/tool-handlers.test.js` 已新增 uid select visible text path 断言，确保结果保留
  `selected`、`uid`、`value`、`text`、`selectedIndex` 等兼容字段并追加结构化 action result。
- `tests/bridge.test.js` 已更新 select usage hints 断言，锁住 schema 的 selector/value、
  uid/value、uid/text 三条路径。
- 最新 targeted 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 86 项。
- 最新 full 验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖 91 个
  node:test 用例，其中 90 个通过、1 个 real-browser smoke 按默认配置跳过；extension zip
  内容检查通过，包含 13 个文件；npm package 内容检查通过，包含 42 个文件；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token
  残留检查无输出。
- `yunti_select` uid 失败路径已开始返回结构化可恢复诊断：当 uid path 选项未命中时，
  返回 `selected: false`、`code: "OPTION_NOT_FOUND"`、`matchMode`、`targetOption`、
  `availableValues` / `availableTexts` 和 `recoveryHint`，提示先检查可用选项再重试；当
  uid 指向非 select 元素时，返回 `code: "NOT_SELECT"` 和
  `recoveryHint.decision: "use-select-element-or-selector-fallback"`。本切片保留
  selector/value、uid/value、uid/text 成功路径和兼容字段，不恢复为抛错式失败。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js tests/bridge.test.js`
  通过 93 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 93 项；`npm run release:check` 通过，覆盖 98 个 node:test
  用例，其中 97 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_select` selector/value 失败路径已补齐结构化可恢复诊断：当 content-script
  返回的实际值与目标 `value` 不匹配时，返回 `selected: false`、
  `code: "OPTION_NOT_FOUND"`、`actualValue`、`matchMode: "value"`、`targetOption`
  和 `recoveryHint`；当 selector 指向非 select 目标或 content-script 抛错时，返回
  `code: "SELECTOR_SELECT_FAILED"` 与 `recoveryHint.decision:
  "use-select-element-or-uid-fallback"`。本切片保留 selector/value 成功路径和既有兼容字段，
  只在失败时追加结构化诊断。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js tests/bridge.test.js`
  通过 95 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 95 项；`npm run release:check` 通过，覆盖 100 个 node:test
  用例，其中 99 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- P6.2 action path 覆盖清单已重新审计：主要 action result surfaces 均有结构化字段覆盖，
  `yunti_select` 的 selector/value、uid/value、uid/text 路径均已落地并记录；下一步明确
  转向更深 fill/select/scroll 语义增强，而不是继续停留在 select 缺口。
- 最新覆盖审计验证：`git diff --check` 通过；`npm run release:check` 通过，覆盖
  91 个 node:test 用例，其中 90 个通过、1 个 real-browser smoke 按默认配置跳过；
  npm package 内容检查通过，包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；
  token 残留检查无输出。本次为 docs-only 覆盖审计补记，未重新执行真实浏览器 E2E。
- `yunti_fill` uid contenteditable 路径已开始进入更深语义增强：保持现有 CDP keyboard
  输入流程不变，但当目标为 contenteditable 时返回 `method: "contenteditable"`，并附带
  `before` / `after` textLength 摘要和更明确的验证提示。selector fill 和普通 keyboard
  path 兼容字段保持不变。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js` 通过 22 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 87 项；`npm run release:check` 通过，覆盖 92 个 node:test
  用例，其中 91 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_fill` 失败路径开始返回结构化恢复诊断：selector 抛错和 uid select option miss
  不再只依赖外层通用 error，而是返回 `filled: false`、`ok: false`、`recoverable: true`、
  `code`、`recoveryHint` 和 `nextStepHint`。select option miss 会附带
  `availableValues` / `availableTexts`，帮助 agent 先检查可选项再重试。本切片保持所有成功
  fill 兼容字段与派发语义不变。
- 最新 targeted 验证：`node --check extension/tool-handlers.js` 通过；
  `node --test tests/tool-handlers.test.js` 通过 32 项。
- 最新 full 验证：`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 102 个 node:test 用例，其中 101 个通过、1 个
  real-browser smoke 按默认配置跳过；npm package 内容检查通过，包含 42 个文件；
  extension zip 内容检查通过，包含 13 个文件。
- `yunti_fill_form` 聚合结果现在会保留单字段结构化失败诊断：批量填表仍保留
  `filled`、`failed`、`results`、`action: "fill_form"`、`target`、`ok`、`recoverable`
  和 `nextStepHint` 兼容字段；失败字段的 `results[]` item 会继续携带来自 `yunti_fill`
  的 `code`、`recoveryHint`、`availableValues` / `availableTexts` 和字段级
  `nextStepHint`，帮助 agent 对单个失败字段恢复，而不是只看到 `{ ok: false, error }`。
- 最新 targeted 验证：`node --check extension/tool-handlers.js` 通过；
  `node --test tests/tool-handlers.test.js` 通过 32 项。
- 最新 full 验证：`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 102 个 node:test 用例，其中 101 个通过、1 个
  real-browser smoke 按默认配置跳过；npm package 内容检查通过，包含 42 个文件；
  extension zip 内容检查通过，包含 13 个文件。
- `yunti_fill` 不可编辑目标诊断已补齐：uid fill 会在派发键盘事件前检查目标是否隐藏、
  disabled、readonly 或不是 input/textarea/select/contenteditable 等可编辑目标；selector
  fill 的 content-script 路径也会在 `setEditableText` 前检查 hidden/no-size、disabled、
  readonly 和不可编辑 input type。失败时返回或归类为 `code: "TARGET_NOT_EDITABLE"`，
  透传 `filled: false`、`ok: false`、`recoverable: true`、`recoveryHint` 和
  `nextStepHint`，uid 路径还会附带轻量 `element` 诊断元数据。本切片不改变成功 fill、
  select、contenteditable 或 CDP fallback 兼容字段。
- 最新 targeted 验证：`node --check extension/tool-handlers.js` 通过；
  `node --check extension/content.js` 通过；`node --test tests/tool-handlers.test.js`
  通过 34 项。
- 最新 full 验证：`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 104 个 node:test 用例，其中 103 个通过、1 个
  real-browser smoke 按默认配置跳过；npm package 内容检查通过，包含 42 个文件；
  extension zip 内容检查通过，包含 13 个文件。
- `yunti_observe_page` 字段状态提示已补齐：观察元素现在可追加 `editable`、`fillable`、
  `readOnly`、`fillBlockReason` 和 select `options[]` 摘要，帮助 agent 在调用
  `yunti_fill` / `yunti_select` 前判断字段是否可填、是否 readonly/disabled/hidden，以及
  可选项 value/text。该切片只追加观察字段和使用提示，不改变 uid 生命周期、redaction 默认值、
  click/fill/select/scroll/CDP/截图/network/console 等既有动作能力。
- 最新 targeted 验证：`node --check extension/dom-observer.js` 通过；
  `node --test tests/dom-observer.test.js` 通过 5 项；`node --test tests/bridge.test.js`
  通过 65 项。
- 最新 full 验证：`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 105 个 node:test 用例，其中 104 个通过、1 个
  real-browser smoke 按默认配置跳过；npm package 内容检查通过，包含 42 个文件；
  extension zip 内容检查通过，包含 13 个文件。
- `yunti_observe_page` select 当前状态提示已补齐：select 元素现在可追加
  `selectedIndex`、`selectedValue`、`selectedValueRedacted` 和 `selectedText`，并保留
  已有 `options[]` 摘要。Agent 可以先读取当前选中项，再决定是否需要调用
  `yunti_select`，避免重复选择或盲目试错。本切片只追加观察元数据，不改变
  `yunti_select` 执行路径、uid 生命周期或 redaction 默认值。
- 最新 targeted 验证：`node --check extension/dom-observer.js` 通过；
  `node --test tests/dom-observer.test.js` 通过 5 项。
- `yunti_select` disabled option 诊断已补齐：uid/value、uid/text 和 selector/value
  路径遇到已禁用 option 时会返回 `selected: false`、`code: "OPTION_DISABLED"`、
  `disabledValue`、`disabledText` 和结构化 `recoveryHint.decision:
  "choose-enabled-option-or-unlock-field"`，帮助 agent 选择可用选项、等待字段解锁或询问用户。
  本切片不改变正常 select 成功路径、uid 生命周期、selector/value 兼容路径或 CDP 能力。
- 最新 targeted 验证：`node --check extension/tool-handlers.js` 通过；
  `node --check extension/content.js` 通过；`node --test tests/tool-handlers.test.js`
  通过 36 项。
- 最新 full 验证：`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 107 个 node:test 用例，其中 106 个通过、1 个
  real-browser smoke 按默认配置跳过；npm package 内容检查通过，包含 42 个文件；
  extension zip 内容检查通过，包含 13 个文件。
- `yunti_scroll` 已开始支持 fresh scrollable container uid：`yunti_observe_page` 返回的
  `scrollableContainers[]` 会进入当前 browserSessionId 最新 uid map；调用 `yunti_scroll`
  传 `uid` 时会解析容器中心点并复用既有 content-script coordinate/container scroll 路径。
  本切片保留原 `target` 兼容字段，新增 `uid`、`method: "uid"` 和 `scrollTarget`。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js` 通过 23 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 88 项；`npm run release:check` 通过，覆盖 93 个 node:test
  用例，其中 92 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_scroll` 已增加无位移诊断：当 content-script 返回的 `before` / `after`
  scroll position 可比较时，runtime 会追加 `moved`；若位置未变化，则返回
  `code: "NO_SCROLL_MOVEMENT"`、`ok: false`、`recoverable: true`，并提示 observe、
  检查边界、尝试最近的 scrollable container uid 或停止重复同一 scroll。本切片不改变
  原有 scroll 派发路径和 `scrolled`、`target`、`before/after` 兼容字段。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js` 通过 24 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 89 项；`npm run release:check` 通过，覆盖 94 个 node:test
  用例，其中 93 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_scroll` 无位移诊断已增加方向性 `edgeHint`：在 `moved: false` 且 delta 方向
  可判断时，返回 `possible-bottom-edge`、`possible-top-edge`、`possible-right-edge` 或
  `possible-left-edge`，帮助 Agent 判断是否可能到达滚动边界、需要换方向、换容器或停止重复。
  本切片仍不改变原有 scroll 派发路径和兼容字段。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js` 通过 25 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 90 项；`npm run release:check` 通过，覆盖 95 个 node:test
  用例，其中 94 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_scroll` 无位移诊断已新增结构化 `recoveryHint`：在
  `NO_SCROLL_MOVEMENT` 时返回 `reason`、`nextAction`、`recommendedTools`、
  `currentTarget`、`edgeHint`，若使用 fresh scrollable container uid，还会附带
  `lastObservedContainer` 的滚动能力与 remaining pixels 摘要。该字段用于帮助 Agent
  判断 observe、换方向、换容器或停止重复 scroll；本切片不改变 scroll 派发路径和兼容字段。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js` 通过 26 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 91 项；`npm run release:check` 通过，覆盖 96 个 node:test
  用例，其中 95 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_scroll` 无位移恢复提示已新增 `recoveryHint.suggestedRetry`：当
  `edgeHint` 能推导出反向方向时，返回一次性反向 `deltaX` / `deltaY`；uid scroll
  路径会保留同一个 fresh container uid，方便 Agent 尝试一次反向滚动后立即重新 observe。
  该字段是纯新增诊断信息，不改变 scroll 派发路径、兼容字段、`nextAction` 或既有
  `recoveryHint` 结构。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js tests/bridge.test.js`
  通过 91 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 91 项；`npm run release:check` 通过，覆盖 96 个 node:test
  用例，其中 95 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_scroll` 无位移恢复提示已新增 `recoveryHint.decision`：在
  `NO_SCROLL_MOVEMENT` 时根据 `edgeHint` 和是否使用 fresh container uid，返回机器可读的
  恢复决策，例如 `observe-for-scrollable-container`、
  `observe-for-horizontal-scrollable-container`、
  `retry-opposite-vertical-on-same-container-once`、
  `retry-opposite-horizontal-on-same-container-once` 或 `provide-nonzero-delta`。
  该字段帮助 Agent 在 `nextAction` 和 `suggestedRetry` 之间少做分支判断；本切片仍不改变
  scroll 派发路径、兼容字段或既有恢复字段。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js tests/bridge.test.js`
  通过 91 项。
- 最新 full 验证：`git diff --check` 通过；`node --test tests/tool-handlers.test.js
  tests/bridge.test.js` 通过 91 项；`npm run release:check` 通过，覆盖 96 个 node:test
  用例，其中 95 个通过、1 个 real-browser smoke 按默认配置跳过；npm package 内容检查通过，
  包含 42 个文件；extension zip 内容检查通过，包含 13 个文件；`YUNTI_E2E=1 npm run
  test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；token 残留检查无输出。
- `yunti_scroll` coordinate scroll 命中/回退诊断已补齐：当 content script 收到 `x` / `y`
  时，会返回 `coordinateTarget`、`scrollContainerFound` 和必要时的
  `coordinateScrollFallback: "document"`，用于区分坐标是否命中嵌套 scroll container，
  还是回退到 document 滚动。本切片只新增诊断字段，不改变 coordinate/document/uid
  scroll 派发行为。
- `yunti_scroll` coordinate document fallback 恢复提示已补齐：当 handler 收到
  `coordinateScrollFallback: "document"` 时，成功结果保持 `ok: true` /
  `recoverable: false`，并新增 `coordinateFallbackHint` 与更明确的 `nextStepHint`，
  引导 Agent 重新 observe 并优先选择 fresh `scrollableContainers[]` uid，避免误判 nested
  panel 已经被滚动。
- 最新 targeted 验证：`node --test tests/tool-handlers.test.js tests/bridge.test.js
  tests/content-scroll.test.js` 通过 107 项。
- 最新 full 验证：`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 113 个 node:test 用例，其中 112 个通过、1 个
  real-browser smoke 按默认配置跳过；npm package 内容检查通过，包含 42 个文件；
  extension zip 内容检查通过，包含 13 个文件。
- `yunti_get_tool_usage_hints` wait-observe 恢复指导已补齐：action recovery workflow
  和 fill/select/scroll 的工具级 recovery 都明确建议，在异步 UI transition、表单校验、
  option 异步加载或内容继续加载时，使用 `yunti_wait_for` 等待预期 text/selector/state，
  然后重新 `yunti_observe_page` 并用 fresh uid 继续。本切片只更新 agent guidance
  和测试，不改变 runtime action 行为。
- 最新 targeted 验证：`node --test tests/bridge.test.js` 通过 65 项。
- 最新 full 验证：`git diff --check` 通过；token 残留检查无输出；
  `YUNTI_E2E=1 npm run test:e2e` 已执行但因本地缺少 Playwright/Chromium 跳过；
  `npm run release:check` 通过，覆盖 113 个 node:test 用例，其中 112 个通过、1 个
  real-browser smoke 按默认配置跳过；npm package 内容检查通过，包含 42 个文件；
  extension zip 内容检查通过，包含 13 个文件。

详细范围、非目标和验收标准见 `docs/NEXT_MAJOR_PLAN.md`。

## P6.3 Agent 工作流契约

状态：已完成

目标：

将 `observe -> act -> verify` 作为默认 Agent 使用范式写入 skill、tool hints 和文档，
减少盲目重试和坐标操作。

P6.3 的一部分应前置到 P6.1 schema 合并时完成：

- `yunti_get_tool_usage_hints` 必须同步新增 observe-first guidance。
- `skills/yunti-browser-runtime/SKILL.md` 应加入默认循环：
  `hints -> list targets -> observe -> act by uid -> wait if needed -> observe -> verify -> recover or continue`。
- `docs/TOOL_GUIDE.md` 应补点击、填表、滚动找元素、切 tab、等待异步结果五个最小用例。
- 提供可复制提示词，指导外部 Agent 避免盲目重复失败动作，并在提交、删除、支付、
  上传敏感文件或修改生产数据前请求用户确认。

详细范围、非目标和验收标准见 `docs/NEXT_MAJOR_PLAN.md`。

## P6.4 DOM 脱敏与页面内容策略

状态：已完成

目标：

把 DOM observation 的敏感内容脱敏提升为一等能力，与现有 network/console redaction
形成统一安全边界。

P6.1 已前置最小 DOM observation 脱敏基线；P6.4 负责深化：

- `strict` 模式覆盖 email、phone、证件号/银行卡-like、地址-like 和正文中的 credential-like
  片段。
- 对齐 DOM、network、console 的敏感词和字段策略。
- 明确 learning memory、task history、diagnostic artifacts 默认不存 secret，并提供清理路径。
- 明确截图默认是真实像素，不承诺被 DOM redaction 遮蔽。

P6.4.1 已落地：

- `strict` 模式会在 DOM observation 的 page title、label、name、visible text、
  placeholder、value preview、select selected value/text、options value/text 和
  scrollable container name 中遮蔽更广的 PII-like 内容。
- 新增类别包括 `email`、`phone`、`payment_card` 和 `address`；payment card-like
  值要求 13-19 位数字且通过 Luhn 校验，减少普通长数字误伤。
- `balanced` 仍保持默认 credential-like 保护，不因普通业务文本变长而过度遮蔽；
  `off` 仍只用于显式本地调试。
- `docs/TOOL_GUIDE.md`、`skills/yunti-browser-runtime/SKILL.md`、`docs/SECURITY.md`
  和 `yunti_get_tool_usage_hints` 已同步 strict/balanced/off 的使用边界。
- `tests/dom-observer.test.js` 已覆盖 strict PII 类别、select option text 脱敏、
  page title 脱敏和 balanced 普通业务文本不误伤。

P6.4.2 已落地：

- `mcp/redaction.js` 统一增强 likely-sensitive text 脱敏，覆盖 Bearer、JWT、
  private key、长 token-like、email、phone、Luhn-valid payment-card-like 和 address-like。
- `yunti_remember_learning` 写入 title、detail、tags、source 前统一脱敏，避免 learning
  memory 成为 secret 或 PII-like 长期存储。
- `yunti_list_console_messages` / `yunti_get_console_message` 返回的 text、stackTrace 和 args
  在缓存前统一脱敏。
- `yunti_get_cdp_events` 保持 raw low-level diagnostics 语义，但文档和 tool hints 已明确
  这是例外，应在调试后用 `yunti_clear_cdp_events` 清理。

P6.4.3 已落地：

- `yunti_get_tool_usage_hints` 已为 `yunti_get_cdp_events`、`yunti_clear_cdp_events`、
  `yunti_take_screenshot` 和 `yunti_capture_visible_tab` 增加安全边界和清理 guidance。
- Raw CDP 诊断明确优先使用 sanitized network/console 工具，必要时按 `method` 和 `limit`
  缩小范围，用后清理，且不复制 raw params 到聊天、文档或 learning memory。
- Screenshot 诊断明确是真实可见像素，不受 DOM redaction 保护；优先 viewport 截图，
  只总结安全视觉结论，不把 raw image data 存入 learning memory。

详细范围、非目标和验收标准见 `docs/NEXT_MAJOR_PLAN.md`。

## P6.5 可选本地运行时控制台

状态：已完成；P6.5.1-P6.5.3 已完成

目标：

提供非必选的本地调试控制台，用于查看 bridge 状态、连接页面、最近工具调用、错误和
stop/cancel 操作，同时保持 popup 零配置。

P6.5.1 完成范围：

- `yunti-browser-runtime console` 启动 bridge 并打印本地控制台 URL。
- bridge 提供 `/console` 页面、`/console/state` 脱敏状态 JSON 和
  `/console/cancel-pending` 取消 runtime pending/queued 请求接口。
- 控制台展示 connected pages、pending/queued requests、network/console/CDP 诊断数量和
  最近工具 activity；页面标题、用户信息、URL 和错误摘要统一走脱敏/URL 清洗。
- 启用 `YUNTI_BROWSER_BRIDGE_TOKEN` 时，`/console/state` 和 cancel 接口仍受 token 保护；
  页面 shell 只提示需要受保护诊断，不泄露 session 明细。
- cancel 只清理 runtime 仍在等待或排队的请求，不承诺撤销已经发生的浏览器副作用。

P6.5.2 完成范围：

- 增强空状态和 stale session 的操作指引。
- 展示 bridge/package 与 extension version mismatch 警告。
- `HEAD /console` 与 `GET /console` 一样返回 200，便于探活工具检查。
- `doctor` JSON 和 human summary 中加入 console URL。

P6.5.3 完成范围：

- `YUNTI_E2E=1 npm run test:e2e` 覆盖真实扩展注册后控制台状态。
- 验证 `HEAD /console`、`GET /console` 和 `/console/state` 都可用。
- 验证 runtime version、expected extension version 和 session extension version 与
  package version 一致。
- 验证真实页面连接后不会出现 `NO_CONNECTED_PAGES` 或
  `EXTENSION_VERSION_MISMATCH` warning。

P6.6.1 完成范围：

- 审计当前 `extension/manifest.json` 的 permissions / host_permissions。
- 整理 Chrome Web Store / Edge Add-ons 所需的权限说明、隐私说明和素材清单。
- 保留 unpacked extension 开发路径，不在第一刀里改变现有权限行为。
- 新增 `docs/EXTENSION_DISTRIBUTION.md`，并从 README、Security 和 Roadmap 链接。

P6.6.2 完成范围：

- 起草面向 Chrome Web Store / Edge Add-ons 的权限说明和隐私披露文本。
- 覆盖 `debugger`、`tabs`、`webRequest`、广泛 `http` / `https` host access、
  localhost bridge、DOM observation、screenshots、network/console diagnostics
  和 learning memory。
- 只沉淀文案与决策依据；不在这一刀直接收窄 manifest 权限。
- 新增 `docs/EXTENSION_STORE_COPY.md`，包含 short/long description、permission
  rationale、privacy-policy draft、store data disclosure guidance、reviewer notes
  和 final review checklist。

P6.6.3 完成范围：

- 决定商店版本前的权限策略：继续 broad host access、迁移到 optional host
  permissions、将 `webRequest` 诊断可选化，或明确 0.2.0 继续只保留 unpacked/npm
  分发路径。
- 如果改变行为，需要同步 extension manifest/UX、`mcp/tools.js`、Tool Guide、skill、
  Security docs 和测试。
- 新增 `docs/EXTENSION_PERMISSION_STRATEGY.md`，明确当前 npm/unpacked 路径保持完整能力；
  当前 broad-permission manifest 不建议默认直接提交商店；store-candidate track
  需要先设计 optional host access、missing-permission recovery 和 optional diagnostics。
- 本切片不改变 extension manifest 或 runtime 行为。

P6.6.4 后置：

- 设计 store-candidate 权限 UX 和技术原型计划。
- 明确 popup/doctor/MCP error/tool hints/Tool Guide/skill/tests 在 optional host access
  和 optional network diagnostics 下如何变化。

详细范围、非目标和验收标准见 `docs/NEXT_MAJOR_PLAN.md`。

## P6.6 浏览器扩展分发准备

状态：0.2.0 npm/unpacked 范围已完成；P6.6.4 后置到 post-0.2 store-candidate track

目标：

准备 Chrome Web Store / Edge Add-ons 上架材料和权限说明，降低最终用户手动加载扩展的
安装成本，同时保留 unpacked extension 开发路径。

P6.6.1 已完成：

- `docs/EXTENSION_DISTRIBUTION.md` 记录当前 manifest 权限审计、官方策略参考、
  store submission checklist、隐私披露主题和权限收窄选项。
- 该审计已接入 README、Security 和 Roadmap，避免后续发布商店版本前丢失上下文。
- 本切片不改变 extension runtime 行为，也不收窄 manifest 权限。

P6.6.1 最新验证：

- `git diff --check` 通过。
- token 残留检查无输出。
- `npm run check` 通过。
- `npm test` 通过，覆盖 126 个 node:test 用例，其中 125 个通过、1 个默认真实浏览器
  smoke 按配置跳过。
- `YUNTI_E2E=1 npm run test:e2e` 在本机 `pytest-playwright` 环境下通过 1 个真实浏览器
  extension bridge smoke；conda 仅打印 requests 依赖版本 warning，不影响结果。
- `npm run release:check` 通过，包含 public documentation residue check、15 个公开
  Markdown 文件链接检查、action result coverage 11 行、npm package 内容 46 个文件和
  extension zip 内容 13 个文件。

P6.6.2 已完成：

- 将 P6.6.1 的审计结果转成可提交商店时使用的 permission rationale 和 privacy copy 草案。
- 明确哪些内容可直接用于 store listing，哪些仍需用户/维护者最终确认。
- `docs/EXTENSION_STORE_COPY.md` 已沉淀 store listing description、permission
  rationale、privacy policy draft、data disclosure guidance、reviewer notes 和
  final review checklist。
- 本切片不改变 extension manifest 或 runtime 行为。

P6.6.2 最新验证：

- `git diff --check` 通过。
- token 残留检查无输出。
- `npm run check` 通过。
- `npm test` 通过，覆盖 126 个 node:test 用例，其中 125 个通过、1 个默认真实浏览器
  smoke 按配置跳过。
- `YUNTI_E2E=1 npm run test:e2e` 在本机 `pytest-playwright` 环境下通过 1 个真实浏览器
  extension bridge smoke；conda 仅打印 requests 依赖版本 warning，不影响结果。
- `npm run release:check` 通过，包含 public documentation residue check、16 个公开
  Markdown 文件链接检查、action result coverage 11 行、npm package 内容 47 个文件和
  extension zip 内容 13 个文件。

P6.6.3 已完成：

- 在不迷失 Yunti local-first / MCP-native 特色的前提下，做商店前权限策略决策。
- 优先评估 broad host permissions 和 `webRequest` 是否继续保持默认、改为 optional，或
  延后商店上架。
- `docs/EXTENSION_PERMISSION_STRATEGY.md` 已明确两轨策略：developer/npm track
  保持当前 zero-config broad-access 体验；store-candidate track 另行设计可选 host access
  和可选 network diagnostics。
- 当前 manifest 和 runtime 行为不变。

P6.6.3 最新验证：

- `git diff --check` 通过。
- token 残留检查无输出。
- `npm run check` 通过。
- `npm test` 通过，覆盖 126 个 node:test 用例，其中 125 个通过、1 个默认真实浏览器
  smoke 按配置跳过。
- `YUNTI_E2E=1 npm run test:e2e` 在本机 `pytest-playwright` 环境下通过 1 个真实浏览器
  extension bridge smoke；conda 仅打印 requests 依赖版本 warning，不影响结果。
- `npm run release:check` 通过，包含 public documentation residue check、17 个公开
  Markdown 文件链接检查、action result coverage 11 行、npm package 内容 48 个文件和
  extension zip 内容 13 个文件。

P6.6.4 后置：

- 做 store-candidate 权限 UX 设计，列清楚用户操作、agent 恢复提示、doctor 检查和测试矩阵。
- 该设计完成后，再决定是否进入 manifest/extension 代码实现。
- 该工作不作为 0.2.0 npm/unpacked 发布硬门槛，后续作为 store-candidate track 单独推进。

## P7.1 0.2.0 npm/unpacked 发布收口

状态：已完成

目标：

冻结 0.2.0 范围，发布 npm/unpacked extension 形态；商店候选版权限 UX 后置。

完成范围：

- package 和 extension 版本同步提升到 `0.2.0`。
- README / Release / status / execution plan 先更新为 0.2.0 发布候选状态，并在发布后
  更新为已发布状态。
- 执行 `npm run check:metadata`、`npm run release:prepublish`、真实浏览器 E2E、
  `npm run release:dry-run`、`npm run release:publish` 和
  `npm run release:verify-published`。

当前验证：

- `git diff --check` 通过。
- token 残留检查无输出。
- `npm run check:metadata` 通过，确认 GitHub repository/homepage/bugs URL 为 200。
- `npm run release:check` 通过，包含 public documentation residue check、18 个公开
  Markdown 文件链接检查、version consistency check `0.2.0`、CLI smoke `0.2.0`、
  action result coverage 11 行、npm package 内容 49 个文件和 extension zip 内容 13 个文件。
- `YUNTI_E2E=1 npm run test:e2e` 在本机 `pytest-playwright` 环境下通过 1 个真实浏览器
  extension bridge smoke；conda 仅打印 requests 依赖版本 warning，不影响结果。
- `npm run release:dry-run` 通过，生成 `yunti-browser-runtime-0.2.0.tgz` dry-run
  预览，tarball 共 49 个文件。
- `npm run release:publish` 已发布 `yunti-browser-runtime@0.2.0` 到官方 npm registry。
- `npm run release:verify-published` 已验证 name、version、repository、homepage、bugs
  和 tarball URL。

下一步：

- 选择 post-0.2 下一阶段；P6.6.4 store-candidate 权限 UX 仍作为浏览器商店方向后置。

详细范围、非目标和验收标准见 `docs/NEXT_MAJOR_PLAN.md`。

## 每阶段完成后的固定检查

```bash
npm run check
npm test
```

涉及真实浏览器链路时额外执行：

```bash
npm run test:e2e
```

P6.1/P6.2 browser behavior 变更合并前必须执行：

```bash
YUNTI_E2E=1 npm run test:e2e
```

最小 fixture 矩阵：

- `observe-basic.fixture.html`
- `observe-redaction.fixture.html`
- `observe-scroll.fixture.html`
- `observe-dynamic.fixture.html`
- `actions-form.fixture.html`
- `actions-contenteditable.fixture.html`
- `actions-scroll-container.fixture.html`

这些 fixture 是本地确定性回归，不是 benchmark 优化目标。

涉及文档/开源化时额外检查：

```bash
rg "/U[s]ers|C[o]deg|x[y]y|y[b]m100" README.md docs skills package.json
```

## 当前下一步

P0.1-P7.2、P0.4 和 P0.5 已完成，`yunti-browser-runtime@0.2.3` 已发布到官方 npm
registry，`latest` 已确认指向 `0.2.3`。完整 release check 已通过：146 个
node:test 用例中 145 个通过、1 个真实浏览器 smoke 默认跳过；单独启用真实浏览器
E2E 后 1 个 smoke 用例通过。下一步进入 `0.2.3` 用户反馈观察，不再继续扩大该补丁
范围；如仍出现 session 失效，应采集 bridge state 并按新的单 controller 不变量定位。

## P7.2 0.2.1 安装后自动注入 / 自动注册页面

状态：已完成；后续 controller 架构由 P0.3、P0.4 接续并取代全页面持续注册策略。

目标：

让用户加载扩展后尽量不需要手动刷新页面。扩展后台应主动扫描可访问的 `http` /
`https` tabs，对没有注册 session 的页面注入 `dom-observer.js`、`content.js` 和
`content.css`，再触发 `yunti_refresh_registration`，使 Agent 能直接发现和操作已打开页面。
bridge 重启或 background service worker 恢复后，也应尽量自动恢复注册。

非目标：

- 不绕过 Chrome 对 `chrome://`、扩展页、Web Store、权限不足页面等不可注入页面的限制。
- 不引入远程服务、不要求用户填写 token、不要求默认打开 popup。
- 不改变普通 observe-first action 的非 CDP 默认路径。

验收：

- manifest 增加必要的 `scripting` 能力。
- background/session manager 支持 scan -> ping -> inject -> refresh registration。
- 安装/startup、tab update/activation、popup refresh、targets inventory/recovery 等路径能触发恢复。
- README / INSTALL / skill / Tool Guide / usage hints / doctor guidance 不再默认要求用户刷新；
  只把刷新作为无法注入时的兜底恢复。
- `git diff --check`、token 残留检查、`npm run release:check` 通过；涉及真实浏览器链路时执行
  `YUNTI_E2E=1 npm run test:e2e`。

进展：

- manifest 已新增 `scripting` 权限，用于向已打开的受支持页面注入打包内容脚本。
- session manager 已支持 scan -> ping -> inject -> refresh registration，并带同页短时间去重。
- background 已接入 install/startup/background start、tab activated、tab updated complete。
- popup refresh 和 `yunti_list_browser_targets` 已接入自动恢复。
- README、INSTALL、doctor、console guidance、skill、store/permission docs 已改为自动注册优先，
  刷新页面只作为浏览器限制下的兜底。

- 发布后验证已通过：`npm run release:verify-published`。
- 本地默认使用不再需要 bridge token；需要加固时可显式设置
  `YUNTI_BROWSER_BRIDGE_TOKEN`。
- 扩展 popup 默认不需要用户保存设置；Bridge URL、页面匹配和 token 已移入高级设置。
- `0.2.0 Best Browser Automation Runtime` 的大版本计划已沉淀到
  `docs/NEXT_MAJOR_PLAN.md`。
- 继续 0.2.0 的小切片推进：P6.4 已完成 DOM strict redaction、learning memory /
  console diagnostics 存储边界、raw CDP / screenshot 非默认脱敏提示与清理边界。
  P6.1.4 真实浏览器闭环已补验通过，P6.5.1 可选本地运行时控制台最小闭环已完成，
  P6.5.2 控制台诊断增强第一刀已完成，P6.5.3 控制台真实浏览器 E2E 验收已完成，
  P6.6.1 浏览器扩展分发准备已完成，P6.6.2 商店权限与隐私文案草案已完成，
  P6.6.3 商店前权限策略决策已完成。P6.6.4 Store candidate 权限 UX 设计已后置；
  P7.1 0.2.0 npm/unpacked 发布收口已完成。
- 保持兼容：不改变成功 fill、select、scroll、CDP、截图、network/console、file upload 或 tab
  能力；新增诊断只在失败结果或 observe 元数据里追加更具体的 `code`、`recoveryHint`、
  `element` / 字段状态摘要和验证提示。
- 验证重点：继续执行
  `git diff --check`、token 残留检查、`YUNTI_E2E=1 npm run test:e2e` 和
  `npm run release:check`。
- 后续如要上架浏览器扩展商店，按 `docs/EXTENSION_PERMISSION_STRATEGY.md` 单独推进
  store-candidate 权限 UX 和 broad host permissions 审查。
- 后续版本开发前，先按 `docs/NEXT_MAJOR_PLAN.md` 拆阶段执行并更新本文档验收记录。
