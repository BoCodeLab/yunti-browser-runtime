# AGENTS.md

本文件面向在此仓库工作的 AI Agent。

## 提交信息必须用中文

每次提交都遵守 [CONTRIBUTING.md](CONTRIBUTING.md)：

1. **标题用中文**，格式 `<类型>: <中文标题>`，一句话说清这次做了什么
2. 正文写清**这次要干什么**（动机与范围）
3. 正文写清**改动了什么功能**（具体改动，性能优化给出实测数据）
4. 正文写清**怎么验证的**

类型前缀：`feat` / `fix` / `perf` / `docs` / `refactor` / `test` / `chore` / `release`。

模板已放在 `.gitmessage`，可用 `git config commit.template .gitmessage` 启用。

## 提交前必须验证

```bash
npm run release:check
```

改动 `extension/` 或 `mcp/` 时，同时运行 `npm test` 并确认全部通过。

**`npm test` 不覆盖真实浏览器验收。** `tests/e2e.test.js`、`tests/browser-interactions.test.js`
和 `tests/uid-identity.test.js` 在没有 `YUNTI_E2E=1` 时整文件跳过，所以只跑 `npm test`
会得到 `fail 0`，但同时 `skipped 3` —— 那不是通过，是没跑。改动页面路由、UID 身份、
等待/超时预算、动作语义或表格预览时，必须在有 Chromium 的机器上额外运行：

```bash
YUNTI_E2E=1 npm run test:interactions   # 动作语义 + uid 身份（发布前必跑）
YUNTI_E2E=1 npm run test:e2e            # 整链路冒烟
```

验收标准是输出里的 `fail 0` **且** `skipped 0`。

## 其它约定

- 公开文档不要出现本机绝对路径、内部代号或个人信息
- 新增公开工具必须同步更新 soak coverage 清单
- 不要提交 `.probe-out*/`、`dist/`、`node_modules/` 等产物
