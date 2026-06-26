# Test Cases: Cache Selector 泛化

**状态：** 待评审

## 1. 单元测试

### 1.1 SelectorStore

| # | 测试名称 | 前置条件 | 测试步骤 | 期望结果 |
|---|---------|---------|---------|---------|
| 1 | set/get 基本读写 | 空 store | `store.set("指令A", "article a")` → `store.get("指令A")` | 返回 `"article a"` |
| 2 | get 不存在的 key | 空 store | `store.get("不存在")` | 返回 `undefined` |
| 3 | has 存在 | store 有 "指令A" | `store.has("指令A")` | 返回 `true` |
| 4 | has 不存在 | 空 store | `store.has("指令A")` | 返回 `false` |
| 5 | size | 写入 3 条记录 | `store.size` | 返回 `3` |
| 6 | clear | store 有记录 | `store.clear()` → `store.size` | 返回 `0` |
| 7 | 相同 key 覆盖 | store 有 "指令A" = "old" | `store.set("指令A", "new")` → `store.get("指令A")` | 返回 `"new"` |

### 1.2 Schema 增强 (injectCssSelectorField)

| # | 测试名称 | 输入 | 期望结果 |
|---|---------|------|---------|
| 1 | 正常注入 cssSelector 字段 | act schema JSON（含 action.properties） | action.properties 中新增 cssSelector 字段 |
| 2 | 原有字段不变 | act schema JSON | elementId/description/method/arguments 保持不变 |
| 3 | schema 结构不匹配时不报错 | `{}` | 返回原始 schema，不抛异常 |

### 1.3 CSS Selector 捕获 (captureCssSelector)

| # | 测试名称 | LLM 返回 | 期望结果 |
|---|---------|---------|---------|
| 1 | 正常捕获 | `{ action: { elementId: "0-1", cssSelector: "article a" } }` | selectorStore 中有对应记录 |
| 2 | 无 cssSelector 字段 | `{ action: { elementId: "0-1" } }` | selectorStore 无新记录 |
| 3 | cssSelector 为空字符串 | `{ action: { cssSelector: "" } }` | 不存入 store |
| 4 | cssSelector 以 xpath= 开头 | `{ action: { cssSelector: "xpath=/html..." } }` | 不存入 store |
| 5 | cssSelector 以 /html 开头 | `{ action: { cssSelector: "/html/body" } }` | 不存入 store |
| 6 | action 为 null | `{ action: null, twoStep: false }` | 不存入 store |

### 1.4 generalizeCacheSelectors

| # | 测试名称 | 前置条件 | 期望结果 |
|---|---------|---------|---------|
| 1 | 正常替换 xpath | 缓存含 `xpath=/html/.../a[1]`，store 有对应 cssSelector | selector 替换为 CSS，文件更新 |
| 2 | 无对应 store 记录 | 缓存含 xpath，store 为空 | selector 保留原值，skippedSelectors++ |
| 3 | 非 xpath 选择器不处理 | 缓存含 `article a`（已是 CSS） | selector 保持不变 |
| 4 | 空缓存目录 | 目录无 JSON 文件 | totalFiles=0, updatedSelectors=0 |
| 5 | 多 actions 条目 | 一个缓存文件含 2 个 actions | 两个 xpath 都被替换 |
| 6 | 缓存文件格式异常 | JSON 解析失败 | 跳过该文件，不报错 |

### 1.5 LLM Client 集成（enableSelectorGeneralization 开关）

| # | 测试名称 | 配置 | 期望结果 |
|---|---------|------|---------|
| 1 | 开启时增强 schema | `enableSelectorGeneralization: true` | JSON Schema 含 cssSelector 字段 |
| 2 | 开启时增强 prompt | `enableSelectorGeneralization: true` | system prompt 含 CSS 选择器指令 |
| 3 | 关闭时不增强 schema | `enableSelectorGeneralization: false` | JSON Schema 无 cssSelector 字段 |
| 4 | 关闭时不增强 prompt | `enableSelectorGeneralization: false` | system prompt 无 CSS 选择器指令 |
| 5 | 默认开启 | 不传 enableSelectorGeneralization | 行为等同 `true` |

## 2. 测试文件规划

```
tests/
├── selector-store.test.ts          # 1.1 SelectorStore 单元测试
├── cache-updater.test.ts           # 1.4 generalizeCacheSelectors 单元测试
└── llm-client.test.ts              # 1.2 + 1.3 + 1.5（扩展现有测试文件）
```

## 3. Mock 策略

- **ClaudeCodeLanguageModel.generate()**：mock 返回预设的 structured_output（含/不含 cssSelector）
- **文件系统**：使用临时目录 + 预置 JSON 文件测试 cache-updater
- **Stagehand 内部处理**：不 mock（不在测试范围内）
