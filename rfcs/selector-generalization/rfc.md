# RFC: Cache Selector 泛化 — LLM Schema 增强方案

**状态：** 待评审

## 1. 问题陈述

### 现状

Stagehand `act()` 内部通过 `normalizeActInferenceElement` 函数，**硬编码**将 LLM 返回的 `elementId` 映射为绝对 XPath 选择器：

```javascript
// actHandler.js — normalizeActInferenceElement
return {
    selector: `xpath=${trimmed}`,  // 始终生成绝对 XPath
};
```

生成的缓存条目示例：

```json
{
  "selector": "xpath=/html[1]/body[1]/div[2]/div[1]/div[1]/section[1]/article[1]/footer[1]/a[1]"
}
```

### 问题

绝对 XPath 的泛化性极差：
- 页面任何外层 `div` 增减都会导致选择器失效
- 即使目标元素本身未变化，无关的布局调整也会触发自愈
- CI 缓存命中率低，自愈调用频繁导致成本上升

### 关键发现

1. **缓存回放支持 CSS 选择器** — `page.waitForSelector()` 和 `resolveLocatorWithHops()` 均支持 CSS 选择器
2. **LLM 无法控制选择器格式** — LLM 只返回 `elementId`，Stagehand 内部转换为 xpath
3. **LLM 拥有充分的页面信息** — act() 调用时 LLM 收到完整的可访问性树，有能力推断出语义化 CSS 选择器

## 2. 方案选择与决策

### 选定方案：LLM Schema 增强 + 缓存后处理

在 `ClaudeCodeLLMClient` 处理 act() 调用时，**增强传给 Claude Code 的 JSON Schema**，额外要求返回 `cssSelector` 字段。LLM 在同一次推理中同时输出 elementId（供 Stagehand 使用）和 cssSelector（供我们后处理使用）。

### 否决方案

| 方案 | 否决理由 |
|------|----------|
| 独立后处理 LLM 调用 | N 次额外 LLM 调用，成本高；后处理时缺少页面可访问性树，信息不足 |
| Monkey-patch Stagehand | 依赖框架内部实现，升级即破坏 |
| 纯确定性规则转换 | 无法覆盖复杂页面结构，质量上限低 |

## 3. 架构设计

### 数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│ act("点击第一个博客卡片的 Read more 按钮")                              │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ ClaudeCodeLLMClient.createChatCompletion()                          │
│                                                                     │
│  检测到 schemaName === "act"                                        │
│  → 增强 JSON Schema: 添加 cssSelector 字段                          │
│  → 增强 system prompt: 添加 CSS 选择器生成指令                       │
│  → 调用 Claude Code                                                 │
│                                                                     │
│  LLM 返回: { action: { elementId, description, method,              │
│              arguments, cssSelector }, twoStep }                     │
│                                                                     │
│  → 捕获 cssSelector 存入 SelectorStore                              │
│  → 返回完整响应给 Stagehand（Stagehand 忽略 cssSelector 字段）       │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Stagehand 内部处理                                                   │
│  → normalizeActInferenceElement: elementId → xpath                   │
│  → 执行操作                                                         │
│  → 缓存 xpath 选择器到 .stagehand-cache/                            │
└─────────────────┬───────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 测试结束后: generalizeCacheSelectors(cacheDir)                       │
│                                                                     │
│  → 遍历 .stagehand-cache/*.json                                     │
│  → 对每个 xpath 选择器:                                              │
│      1. 查询 SelectorStore 获取 cssSelector                         │
│      2. 若无有效 cssSelector → 保留原始 xpath                        │
│  → 写回更新后的缓存文件                                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键组件

#### 3.1 SelectorStore

内存级的 `instruction → cssSelector` 映射存储：

```typescript
class SelectorStore {
  private store: Map<string, string>;  // instruction → cssSelector
  set(instruction: string, cssSelector: string): void;
  get(instruction: string): string | undefined;
  entries(): [string, string][];
  clear(): void;
}
```

#### 3.2 LLM Client Schema 增强

在 `createChatCompletion` 中检测 act schema，动态注入 cssSelector 字段：

```typescript
// 检测 act schema
if (schemaName === "act") {
  // 1. 增强 JSON Schema — 添加 cssSelector 字段
  jsonSchema = injectCssSelectorField(jsonSchema);
  
  // 2. 增强 system prompt — 添加 CSS 选择器生成指令
  systemPrompt += CSS_SELECTOR_INSTRUCTION;
}
```

#### 3.3 Cache Updater

读取缓存目录，替换 xpath 为 cssSelector：

```typescript
function generalizeCacheSelectors(
  cacheDir: string,
  selectorStore: SelectorStore
): { updated: number; total: number };
```

## 4. 影响范围

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/llm-client.ts` | 修改 | Schema 增强逻辑 + cssSelector 捕获 |
| `src/selector-store.ts` | 新增 | SelectorStore 类 |
| `src/cache-updater.ts` | 新增 | 缓存后处理逻辑 |
| `src/types.ts` | 修改 | 新增导出类型 |
| `src/index.ts` | 修改 | 导出新 API |
| `examples/mdn-blog/e2e-skills/CLAUDE.md` | 修改 | 添加 CSS 选择器策略指导 |

**不变**：Stagehand 框架、现有测试、现有 API 行为

## 5. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 返回无效 cssSelector | 缓存未更新，保留原始 xpath | 验证 cssSelector 格式合法性，无效则跳过 |
| cssSelector 在页面上不唯一 | 点击到错误元素 | afterAll 中可选地验证 selector（playwright locator.count() === 1） |
| Stagehand 未来版本修改 act schema name | Schema 增强不触发 | 通过检测 schema 结构（而非仅 name）来判断 |
| act() 响应 token 增加 | 成本微增 | cssSelector 通常 < 50 chars，影响可忽略 |

## 6. 决策记录

1. **不验证 CSS 选择器有效性** — 信任 LLM 输出质量，无效时保留原始 xpath 即可
2. **SelectorStore 不持久化** — 内存级，生命周期与测试进程一致
3. **CLAUDE.md skill 中的 CSS 选择器策略仅影响 act() 场景** — Schema 增强仅在 `schemaName === "act"` 时触发
