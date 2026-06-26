# SPEC: Cache Selector 泛化 — 技术规格

**状态：** 待评审

## 1. 公共 API 设计

### 1.1 新增导出

```typescript
// src/index.ts 新增导出
export { SelectorStore } from "./selector-store.js";
export { generalizeCacheSelectors } from "./cache-updater.js";
export type { CacheUpdateResult, CacheUpdateOptions } from "./types.js";
```

### 1.2 SelectorStore

```typescript
// src/selector-store.ts

/**
 * 内存级的 instruction → cssSelector 映射存储。
 * 在 act() 调用期间自动收集 LLM 返回的 cssSelector，
 * 供测试结束后的缓存后处理使用。
 */
export class SelectorStore {
  private store: Map<string, string>;

  constructor();

  /** 存储 instruction 对应的 cssSelector */
  set(instruction: string, cssSelector: string): void;

  /** 获取 instruction 对应的 cssSelector */
  get(instruction: string): string | undefined;

  /** 检查是否存在某 instruction 的记录 */
  has(instruction: string): boolean;

  /** 返回所有映射条目 */
  entries(): IterableIterator<[string, string]>;

  /** 当前存储条目数 */
  get size(): number;

  /** 清空所有记录 */
  clear(): void;
}
```

### 1.3 generalizeCacheSelectors

```typescript
// src/cache-updater.ts

export interface CacheUpdateOptions {
  /** 缓存目录路径 */
  cacheDir: string;

  /** SelectorStore 实例（从 llmClient 获取） */
  selectorStore: SelectorStore;
}

export interface CacheUpdateResult {
  /** 缓存文件总数 */
  totalFiles: number;

  /** 已更新的选择器数量 */
  updatedSelectors: number;

  /** 跳过的选择器数量（无对应 cssSelector 或非 xpath） */
  skippedSelectors: number;

  /** 更新详情 */
  details: Array<{
    file: string;
    instruction: string;
    oldSelector: string;
    newSelector: string;
  }>;
}

/**
 * 遍历缓存目录中的 JSON 文件，将 xpath 选择器替换为 SelectorStore 中的 CSS 选择器。
 * 仅处理以 "xpath=" 开头的选择器，非 xpath 选择器保持不变。
 */
export function generalizeCacheSelectors(options: CacheUpdateOptions): CacheUpdateResult;
```

### 1.4 ClaudeCodeLLMClientOptions 扩展

```typescript
// src/types.ts 扩展现有接口

export interface ClaudeCodeLLMClientOptions {
  // ... 现有字段不变 ...

  /** 是否启用 selector 泛化（默认 true） */
  enableSelectorGeneralization?: boolean;
}
```

### 1.5 获取 SelectorStore 的方式

```typescript
// src/llm-client.ts — createClaudeCodeLLMClient 返回值增强

/**
 * 创建 ClaudeCodeLLMClient 实例。
 * 返回的 client 额外附带 selectorStore 属性，用于后处理缓存。
 */
export function createClaudeCodeLLMClient(
  options?: ClaudeCodeLLMClientOptions
): LLMClient & { selectorStore: SelectorStore };
```

## 2. 数据结构定义

### 2.1 增强的 Act JSON Schema

当 `schemaName === "act"` 且 `enableSelectorGeneralization !== false` 时，注入以下字段到 action 对象的 JSON Schema：

```json
{
  "properties": {
    "action": {
      "properties": {
        "cssSelector": {
          "type": "string",
          "description": "A stable, generalized CSS selector for the target element. Use semantic HTML tags (article, section, footer, nav, header), :first-of-type/:nth-of-type() for position, and avoid absolute paths or div-based nesting. Example: 'article:first-of-type footer a' instead of complex xpath paths."
        }
      }
    }
  }
}
```

### 2.2 CSS Selector 生成指令（注入 system prompt）

```typescript
const CSS_SELECTOR_INSTRUCTION = `
IMPORTANT: For the "cssSelector" field, generate a stable CSS selector for the target element following these rules:
1. Use semantic HTML tags: article, section, footer, header, nav, main, aside
2. Use :first-of-type or :nth-of-type(n) for positional disambiguation
3. Avoid absolute paths, div-based nesting, or index-based selectors
4. Keep it as short and semantic as possible
5. The selector must uniquely identify the target element on the page
Example: "article:first-of-type footer a" for the first article's footer link
`;
```

### 2.3 缓存文件格式（不变）

```json
{
  "version": 1,
  "instruction": "点击第一个博客卡片的 Read more 按钮",
  "url": "https://...",
  "variableKeys": [],
  "actions": [
    {
      "selector": "article:first-of-type footer a",
      "description": "...",
      "method": "click",
      "arguments": []
    }
  ]
}
```

## 3. 实现细节

### 3.1 LLM Client Schema 增强流程

```typescript
// llm-client.ts — createChatCompletion 内部

async createChatCompletion<T>(createOptions) {
  // ... 现有逻辑 ...

  // 提取 JSON Schema
  let jsonSchema = toJsonSchema(options.response_model.schema);
  const schemaName = options.response_model?.name;

  // ★ Schema 增强：act 场景注入 cssSelector
  if (schemaName === "act" && this.enableSelectorGeneralization) {
    jsonSchema = this.injectCssSelectorField(jsonSchema);
    systemPrompt = this.appendCssSelectorInstruction(systemPrompt);
  }

  // 调用 Claude Code
  const result = await this.model.generate(systemPrompt, userPrompt, jsonSchema);

  // ★ 捕获 cssSelector
  if (schemaName === "act" && this.enableSelectorGeneralization) {
    this.captureCssSelector(result);
  }

  return this.toExtractResponse<T>(result, schemaName);
}
```

### 3.2 injectCssSelectorField

```typescript
private injectCssSelectorField(schema: object): object {
  const clone = JSON.parse(JSON.stringify(schema));
  
  // 导航到 action.properties 并注入 cssSelector 字段
  const actionProps = clone?.properties?.action?.properties 
    ?? clone?.properties?.action?.anyOf?.[0]?.properties;
  
  if (actionProps) {
    actionProps.cssSelector = {
      type: "string",
      description: "A stable, generalized CSS selector for the target element..."
    };
  }
  
  return clone;
}
```

### 3.3 captureCssSelector

```typescript
private captureCssSelector(result: ClaudeCodeResponse): void {
  const output = result.structured_output;
  if (!output?.action?.cssSelector) return;
  
  const cssSelector = output.action.cssSelector;
  
  // 基本格式验证：非空、不以 xpath= 开头、不含绝对路径特征
  if (
    typeof cssSelector === "string" &&
    cssSelector.length > 0 &&
    !cssSelector.startsWith("xpath=") &&
    !cssSelector.startsWith("/html")
  ) {
    // 使用 instruction 匹配（从 user prompt 中提取）
    const instruction = this.lastActInstruction;
    if (instruction) {
      this.selectorStore.set(instruction, cssSelector);
    }
  }
}
```

### 3.4 generalizeCacheSelectors 实现

```typescript
export function generalizeCacheSelectors(options: CacheUpdateOptions): CacheUpdateResult {
  const { cacheDir, selectorStore } = options;
  const result: CacheUpdateResult = { totalFiles: 0, updatedSelectors: 0, skippedSelectors: 0, details: [] };

  const files = readdirSync(cacheDir).filter(f => f.endsWith(".json"));
  result.totalFiles = files.length;

  for (const file of files) {
    const filePath = join(cacheDir, file);
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    
    if (!content.actions || !Array.isArray(content.actions)) continue;

    const instruction = content.instruction?.trim();
    const cssSelector = instruction ? selectorStore.get(instruction) : undefined;

    let modified = false;
    for (const action of content.actions) {
      if (typeof action.selector === "string" && action.selector.startsWith("xpath=")) {
        if (cssSelector) {
          result.details.push({
            file, instruction,
            oldSelector: action.selector,
            newSelector: cssSelector,
          });
          action.selector = cssSelector;
          modified = true;
          result.updatedSelectors++;
        } else {
          result.skippedSelectors++;
        }
      }
    }

    if (modified) {
      writeFileSync(filePath, JSON.stringify(content, null, 2));
    }
  }

  return result;
}
```

## 4. 错误处理策略

| 场景 | 处理方式 |
|------|----------|
| JSON Schema 注入失败（结构不匹配） | 跳过注入，正常执行 act()，不影响主流程 |
| LLM 未返回 cssSelector 字段 | 跳过捕获，缓存保留原始 xpath |
| cssSelector 格式异常（含 xpath= 前缀） | 丢弃该 selector，不写入 store |
| 缓存文件读写失败 | 跳过该文件，记录到 result 中 |
| selectorStore 中无对应 instruction | 跳过该缓存条目，保留原始 xpath |

## 5. 使用示例

```typescript
import { createClaudeCodeLLMClient, generalizeCacheSelectors } from "@tengxiaohtx/stagehand-cc-agent";

// 1. 创建 client（自带 selectorStore）
const llmClient = createClaudeCodeLLMClient({
  cwd: "./e2e-skills",
  enableSelectorGeneralization: true, // 默认 true
});

// 2. 正常使用 Stagehand — act() 期间自动收集 cssSelector
const stagehand = new Stagehand({ llmClient, cacheDir: "./.stagehand-cache" });
await stagehand.init();
await stagehand.act("点击第一个博客卡片的 Read more 按钮", { page });

// 3. 测试结束后，泛化缓存选择器
const result = generalizeCacheSelectors({
  cacheDir: "./.stagehand-cache",
  selectorStore: llmClient.selectorStore,
});

console.log(`更新了 ${result.updatedSelectors} 个选择器`);
```

## 6. 兼容性说明

- `enableSelectorGeneralization: false` 时完全禁用，行为与现有版本一致
- 不修改 Stagehand 的任何内部行为
- 缓存文件格式不变（仅 selector 字段值从 xpath 变为 css）
- 现有测试不受影响（新功能默认开启但不影响旧缓存回放）
