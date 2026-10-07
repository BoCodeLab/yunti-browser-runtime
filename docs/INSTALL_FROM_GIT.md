# 从 GitHub 源码安装

本文说明如何直接克隆本仓库安装并使用 Yunti Browser Runtime。这种方式不需要 npm
账号，也不依赖任何已发布的 npm 包名，适合二次开发、跟进最新提交、需要在浏览器中
反复重新加载扩展，或所在网络无法访问 npm registry 的场景。

## 前置要求

- Node.js 22 或更高版本。
- Git。
- Chrome、Edge 或其他 Chromium 浏览器。
- 一个支持 MCP 的 Agent。

## 1. 克隆到固定目录

```bash
git clone https://github.com/BoCodeLab/yunti-browser-runtime.git
cd yunti-browser-runtime
```

请把仓库放在一个**固定位置**，例如 `D:\tools\yunti-browser-runtime` 或
`~/tools/yunti-browser-runtime`。原因见第 3 步：生成的 MCP 配置写入的是该目录的
绝对路径。

## 2. 安装依赖

```bash
npm install
```

这一步是**可选**的。运行时部分（MCP server、本地 Bridge、CLI、浏览器扩展）没有
任何第三方依赖，跳过 `npm install` 也能正常使用。安装的 `playwright-core` 只服务于
真实浏览器 E2E 与耐久测试，已声明为 devDependency，不会被以此为依赖安装的用户下载。

## 3. 生成 MCP 配置

```bash
npm run print-config -- --agent codex --human
```

把 `--agent` 换成实际使用的 Agent：`codex`、`claude-code`、`cursor`、`cline`。

命令输出的 JSON 中，`args` 指向本仓库的 `mcp/server.js`。把这段配置加入 Agent 的
MCP 配置后，新建或重载 Agent 会话。Agent 启动 MCP server 时会自动启动本地 Bridge，
通常不需要单独运行 `bridge` 进程。

源码安装不会注册全局命令 `yunti-browser-runtime`，请统一使用 `npm run <命令>` 形式。

## 4. 加载浏览器扩展

在浏览器中完成一次手动加载：

1. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库的 `extension` 目录。

Chrome / Edge 不允许静默安装未上架扩展，因此这一步必须在浏览器中手动确认。

加载完成后，扩展会自动连接 `http://127.0.0.1:48887`、维护 controller 心跳并按需接入
可访问页面。默认不需要填写 token、打开 popup 或保存设置。

## 5. 验证

```bash
npm run doctor
```

确认 runtime、Bridge 和扩展版本一致后，让 Agent 调用：

```text
yunti_list_browser_targets
```

## 更新

```bash
git pull
```

更新后需要在 `chrome://extensions` 或 `edge://extensions` 中点击本扩展的“重新加载”，
浏览器才会使用新的扩展代码。MCP server 会在 Agent 下次建立会话时使用新代码。

如果更新后 `npm run doctor` 报协议或版本不匹配，先重新加载扩展，再重试。

## 常见问题

### Windows 下 `npm run bridge` 报环境变量错误

旧版本的 npm script 使用 POSIX 前置环境变量语法，在 cmd.exe 下无法解析。当前版本
已改为跨平台的 `node scripts/bridge.js`。若仍报错，请确认已 `git pull` 到最新版本。

### 移动仓库目录后 Agent 报找不到 server

MCP 配置保存的是绝对路径。移动目录后重新执行第 3 步生成配置，并更新 Agent 的
MCP 配置。

### 需要真实浏览器测试

```bash
npx playwright-core install chromium
YUNTI_E2E=1 npm run test:e2e
```

### 想验证仓库本身是否健康

```bash
npm install
npm test
npm run release:check
```

`npm run release:check` 会运行公开文档检查、语法检查、单元测试、npm 包内容检查和
扩展 zip 检查。它验证的是仓库的可发布状态，不替代第 5 步的真实连接验证。

## 相关文档

- [安装指南](INSTALL.md)：各 Agent 的接入配置与故障恢复。
- [工具指南](TOOL_GUIDE.md)：全部 MCP 工具、参数规则与操作用例。
- [安全说明](SECURITY.md)：权限、数据边界与脱敏策略。
- [返回 README](../README.md)
