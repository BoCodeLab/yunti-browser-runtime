# 贡献指南

## 提交信息规范

提交信息用**中文**书写，必须回答两个问题：**这次要干什么**、**改动了什么功能**。

### 标题

格式：`<类型>: <中文标题>`

- 标题必须用中文，一句话说清这次提交做了什么
- 不超过 60 个字符，结尾不加句号
- 类型前缀用英文，便于分类和检索：

| 类型 | 用途 |
| --- | --- |
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `perf` | 性能优化 |
| `docs` | 文档 |
| `refactor` | 重构，不改变外部行为 |
| `test` | 测试 |
| `chore` | 构建、依赖、元数据 |
| `release` | 发布准备 |

### 正文

正文用中文，逐条写清楚：

1. **这次要干什么** —— 动机、触发原因、影响范围
2. **改了什么功能** —— 具体改动；性能优化要给出实测数据或明确的测试结论
3. **怎么验证的** —— 跑过哪些测试或验证步骤

行为变化、兼容性影响、需要用户手动做的事，都要明确写出来。

### 示例

```
perf: 把 controller 注册从每轮降低到每 5 轮

- 目的：每次注册包含一次 chrome.tabs.query、一次 bridge 往返和一次 hub session
  清理，而 bridge TTL 是 90 秒，远大于轮询周期，属于可省的开销
- 改动：改为每 5 个轮询周期注册一次，把一次 bridge 往返移出多数工具调用的关键路径；
  liveTabIds 与 tabHandles 仍然每轮刷新，心跳新鲜度不受影响
- 验证：新增回归测试锁定注册节奏；npm test 247 用例全部通过
```

### 本地模板

仓库提供 `.gitmessage` 模板，启用后每次提交会自动带出结构：

```bash
git config commit.template .gitmessage
```

## 提交前检查

```bash
npm run release:check
```

它会检查公开文档残留、Markdown 链接、版本一致性、CLI / doctor / print-config 冒烟、
全量语法检查、单元测试、npm 包内容和扩展 zip 内容。

## 其它约定

- 公开文档不要出现本机绝对路径、内部代号或个人信息
- 改动 `extension/` 或 `mcp/` 时同步更新测试与 `docs/TOOL_GUIDE.md`
- 新增公开工具必须同步更新 soak coverage 清单，否则 `npm run check:action-results` 会失败

## 发布

见 [docs/RELEASE.md](docs/RELEASE.md)。
