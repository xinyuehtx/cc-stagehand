# User Story: Cache Selector 泛化

**状态：** 待评审

## US-1: act() 自动收集泛化选择器

**作为** E2E 测试开发者，  
**我希望** act() 调用时 LLM 自动生成语义化 CSS 选择器，  
**以便** 后续可以用更稳定的选择器替换缓存中脆弱的绝对 XPath。

### 验收标准

- [ ] act() 调用后，`llmClient.selectorStore` 中存在对应 instruction 的 cssSelector
- [ ] cssSelector 不以 `xpath=` 或 `/html` 开头
- [ ] cssSelector 使用语义化标签（article, footer, section 等）
- [ ] Stagehand 正常执行不受影响（elementId 正确传递）
- [ ] `enableSelectorGeneralization: false` 时不收集 cssSelector

### 示例

```typescript
const llmClient = createClaudeCodeLLMClient({ enableSelectorGeneralization: true });
// ... stagehand.act("点击第一个博客卡片的 Read more 按钮", { page });

// act() 完成后
const css = llmClient.selectorStore.get("点击第一个博客卡片的 Read more 按钮");
// css === "article:first-of-type footer a"  (由 LLM 生成)
```

---

## US-2: 测试结束后批量泛化缓存选择器

**作为** E2E 测试开发者，  
**我希望** 测试结束后一键将缓存中的 xpath 替换为 CSS 选择器，  
**以便** 缓存在页面结构微调后依然能命中，减少自愈调用。

### 验收标准

- [ ] `generalizeCacheSelectors()` 读取指定缓存目录的所有 JSON 文件
- [ ] 仅替换以 `xpath=` 开头的选择器
- [ ] 使用 `selectorStore` 中的 cssSelector 进行替换
- [ ] `selectorStore` 中无对应记录时保留原始 xpath
- [ ] 返回 `CacheUpdateResult` 包含统计信息（totalFiles, updatedSelectors, skippedSelectors）
- [ ] 替换后的缓存文件可被 Stagehand 正常回放

### 示例

```typescript
// test.afterAll
const result = generalizeCacheSelectors({
  cacheDir: "./.stagehand-cache",
  selectorStore: llmClient.selectorStore,
});
// result.updatedSelectors === 1
// result.details[0].oldSelector === "xpath=/html[1]/.../a[1]"
// result.details[0].newSelector === "article:first-of-type footer a"
```

---

## US-3: 泛化功能可选关闭

**作为** E2E 测试开发者，  
**我希望** 能够通过配置关闭选择器泛化功能，  
**以便** 在调试或特殊场景下保留原始 xpath 行为。

### 验收标准

- [ ] `createClaudeCodeLLMClient({ enableSelectorGeneralization: false })` 时：
  - LLM 不收到 cssSelector 字段的 schema
  - system prompt 不追加 CSS 选择器指令
  - selectorStore 始终为空
- [ ] 默认值为 `true`（开启）

---

## Demo 脚本

```typescript
import { test } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient, generalizeCacheSelectors } from "@tengxiaohtx/stagehand-cc-agent";

const CACHE_DIR = "./.stagehand-cache";

test.describe("Selector Generalization Demo", () => {
  let stagehand: Stagehand;
  const llmClient = createClaudeCodeLLMClient({
    cwd: "./e2e-skills",
    enableSelectorGeneralization: true,
  });

  test.beforeAll(async () => {
    stagehand = new Stagehand({ env: "LOCAL", llmClient, cacheDir: CACHE_DIR });
    await stagehand.init();
  });

  test.afterAll(async () => {
    // 缓存后处理：xpath → CSS
    const result = generalizeCacheSelectors({
      cacheDir: CACHE_DIR,
      selectorStore: llmClient.selectorStore,
    });
    console.log(`✅ 泛化了 ${result.updatedSelectors} 个选择器`);

    await stagehand.close();
  });

  test("act 并泛化", async () => {
    const page = stagehand.page;
    await page.goto("https://developer.mozilla.org/en-US/blog/");
    await stagehand.act("点击第一个博客卡片的 Read more 按钮", { page });
  });
});
```
