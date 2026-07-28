# Skill: E2E Test Authoring (Playwright + Stagehand)

> 通用「E2E 用例创建」skill —— 指导人或 AI 编码助手写出**高质量、低 flaky、可维护**的
> 端到端测试。融合 [Playwright 官方最佳实践](https://playwright.dev/docs/best-practices)
> 与 [Stagehand 语义自动化](https://docs.stagehand.dev) 两套经验。
>
> 搭配 [`../selector-recognition/CLAUDE.md`](../selector-recognition/CLAUDE.md) 使用：
> 那份管「怎么稳定定位元素」，本文管「怎么设计与编写用例」。

---

## 0. 心智模型：Stagehand 语义 + Playwright 骨架

| 职责 | 用谁 | 例子 |
|------|------|------|
| 导航 / 生命周期 | **Playwright** | `page.goto(url)`、`page.waitForLoadState()`、`page.close()` |
| 断言 | **Playwright（web-first）** | `await expect(page).toHaveURL(...)`、`await expect(loc).toBeVisible()` |
| 语义操作 | **Stagehand** `act()` | `await stagehand.act("点击登录按钮", { page })` |
| 结构化提取 | **Stagehand** `extract()` | `await stagehand.extract("...", schema, { page })` |
| 探查 / 规划 | **Stagehand** `observe()` | 先 observe 再 act，稳定且省 token |
| 自主多步 | **Stagehand** `agent()` | 复杂多步流程 |

> 原则：**能用 Playwright 精确断言/导航的，就别让 LLM 做**；把 LLM 用在「语义定位与操作」上。

---

## 1. 用例设计原则

- **一个用例只验证一个行为**（one behavior per test）；命名清晰描述被测行为。
- **Arrange–Act–Assert** 三段式：准备前置 → 执行操作 → 断言结果。
- **用例之间完全隔离**：不依赖执行顺序、不共享可变状态。Playwright 默认给每个 test
  独立 browser context（独立 cookie/storage）。跨用例的登录态用 *setup project* 复用，
  而非串联依赖。
- **测真实的用户可见行为**，不要测实现细节（函数名、CSS class、内部状态）。
- **外部依赖要 mock**：不受你控制的第三方接口用 `page.route('**/api/...', r => r.fulfill({...}))`
  拦截，保证确定性；数据库用稳定的 staging 数据。

## 2. 定位元素（详见 selector-recognition skill）

Playwright 推荐的定位优先级（面向用户/语义，而非 DOM 结构）：

1. `getByRole(role, { name })` — 交互元素（button/link/checkbox/heading）
2. `getByLabel()` — 有 label 的表单项
3. `getByPlaceholder()` — 无 label 的输入框
4. `getByText()` — 非交互文本
5. `getByAltText()` / `getByTitle()`
6. `getByTestId()` — `data-testid`，最抗重构（改文案/角色不影响）

- ✅ 用 `.filter({ hasText })` / `.and()` / `.or()` 收窄，而非脆弱的长链
  `page.getByRole('listitem').filter({ hasText: 'Product 2' }).getByRole('button', { name: 'Add to cart' })`
- ❌ 不要 `page.locator('#tsf > div:nth-child(2) > div.A8SBwf ...')` 或哈希 class
- ❌ 避免 `.first()/.nth()` 兜底，优先写出**唯一命中**的定位（locator 是严格模式）
- 组件缺少稳定属性时，让开发加 `data-testid`；必要时 `testIdAttribute` 改成你项目的属性名

## 3. 断言：用 web-first 自动重试，杜绝 sleep

- ✅ **务必 `await`** 自动重试断言（默认重试到 5s）：
  `await expect(page.getByText('welcome')).toBeVisible()`
- ❌ 不要 `expect(await loc.isVisible()).toBe(true)`（立即返回、不重试 → flaky）
- ❌ **永远不要硬编码 `waitForTimeout(3000)`**
- 常用重试匹配器：`toBeVisible/Hidden`、`toBeEnabled/Disabled`、`toBeChecked`、
  `toHaveText/toContainText`、`toHaveValue`、`toHaveCount`、`toHaveAttribute`、
  `toBeInViewport`；页面级 `toHaveURL/toHaveTitle`
- 自定义条件用 `await expect.poll(fn).toBe(...)` 或 `await expect(async () => {...}).toPass()`
- 多个非致命断言用 `expect.soft(...)`（失败但不中断）；否定用 `.not`

## 4. Stagehand：选对原语（act / extract / observe / agent）

### `act(instruction, { page })` —— 单个原子操作
- ✅ 一次只做一件事：`act("点击 'Add to Cart' 按钮")`
- ❌ 不要复合：`act("填完表单并提交")`（拆成多个 act）
- 用**元素类型/功能 + 界面上的确切文案**描述，别用颜色/位置；动词要准（click/type/select/check/upload）
- 敏感值用变量占位，避免进日志：`act("输入密码 %password%", { page, variables: { password } })`，并设 `verbose: 0`

### `extract(instruction, zodSchema, { page })` —— 结构化提取
- 用 **Zod schema**，字段名有意义、类型正确，并给每个字段 `.describe(...)`
- 链接用 `z.string().url()`
- 可用 `observe()` 得到的 `selector` 缩小提取范围（**最多省 ~10x token**）

```ts
const product = await stagehand.extract(
  "提取商品卡片的名称、价格、详情链接",
  z.object({
    name: z.string().describe("商品名称"),
    price: z.number().describe("价格，数字"),
    url: z.string().url().describe("详情页链接 href"),
  }),
  { page }
);
```

### `observe(instruction, { page })` —— 先规划再执行
- 返回候选 `Action`（含 `selector`/`method`/`arguments`/`description`）
- **plan-then-execute**：observe 一次，然后对结果循环 `act`，无额外 LLM 调用（快 2–3x）
- 关键操作前先 `if (actions.length > 0)` 校验存在性
- 自动处理 iFrame 与 shadow DOM

```ts
const [action] = await stagehand.observe("点击登录按钮", { page });
if (action) await stagehand.act(action, { page }); // 复用已解析的 selector
```

### `agent(...)` —— 自主多步流程
- 先用 `page.goto` 导航好，再交给 agent
- 指令要**高度具体**，设置 `maxSteps` 匹配复杂度，并写明**成功标准**

## 5. 缓存 / 确定性回放 / 自愈（本库核心价值）

- `act()` 天然**自愈**：页面变化时重新解析选择器。
- 本库把选择器缓存到 `cacheDir` 并**泛化**成稳定 CSS；CI 中命中缓存 → 零 LLM、确定性回放。
- **把 `.stagehand-cache/` 提交进 Git**，CI 才能零成本回放；DOM 大改后再删除重生成。
- 在 `afterAll` 调用本库的 `processCacheAfterAll(...)` 维护泛化 + manifest（TTL/孤儿）：

```ts
processCacheAfterAll({
  cacheDir: CACHE_DIR,
  selectorStore: (stagehand.llmClient as any).selectorStore,
  isFullRun: true,
  ttlSeconds: 30 * 24 * 3600,
  // 权威声明本次用到的 act 指令（缓存命中不经过 LLMClient，必须显式声明）
  usedInstructions: ["点击登录按钮", "点击结算"],
});
```

- **保持缓存 key 稳定**：指令锚定到界面文案（而非位置）、用 `variables`（key 用变量名而非值）、
  固定 viewport、屏蔽第三方/统计脚本造成的 DOM 噪声。

## 6. 可维护性：Page Object / Fixtures

- **POM**：把某页面的 locator 收敛到一个类的属性里，暴露意图级方法（`goto()`、`login()`），
  让用例正文只读得到「做什么」，读不到「怎么定位」。
- 用 fixture 注入 `page` 与页面对象；共享前置（登录、导航）放 `beforeEach` 或 setup project。

## 7. 调试与 CI

- 本地：`--debug` / VS Code 扩展 / `codegen`（生成 resilient locator）。
- CI：trace 设 `on-first-retry`（全量 trace 太重）；失败看 trace viewer。
- 每次 commit/PR 跑；按需安装浏览器 `npx playwright install chromium --with-deps`；
  用 `--shard=1/3` 并行；开启 ESLint `@typescript-eslint/no-floating-promises` 抓漏掉的 `await`。

## 8. 反 flaky 检查清单（写完自检）

1. 是否**只测一个行为**、Arrange-Act-Assert 清晰？
2. 所有断言都用了 **web-first `expect` 且 `await`**？有没有残留 `waitForTimeout`？
3. 定位是否**唯一命中**、用的是 role/label/testid 而非哈希 class / 结构路径？
4. `act` 是否都是**单原子操作**、锚定到确切文案？
5. 外部依赖是否已 mock、测试数据是否稳定？
6. 用例之间是否**完全隔离**、不依赖顺序与共享状态？
7. `.stagehand-cache/` 是否提交、`afterAll` 是否调用了 `processCacheAfterAll`？

---

## 9. 参考模板（Stagehand + Playwright + 本库）

```ts
import { test, expect, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClaudeCodeLLMClient, processCacheAfterAll } from "@tengxiaohtx/stagehand-cc-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".stagehand-cache");
const SKILLS_DIR = join(__dirname, "e2e-skills");
const USED: string[] = []; // 收集本次用到的 act 指令，供 manifest 精确判定孤儿

async function act(sh: Stagehand, instruction: string, page: Page) {
  USED.push(instruction);
  await sh.act(instruction, { page });
}

test.describe("Checkout flow", () => {
  let stagehand: Stagehand;
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    stagehand = new Stagehand({
      env: "LOCAL",
      cacheDir: CACHE_DIR,
      llmClient: createClaudeCodeLLMClient({ cwd: SKILLS_DIR, timeout: 120_000 }),
    });
    await stagehand.init();
    browser = await chromium.connectOverCDP(stagehand.connectURL());
    page = browser.contexts()[0].pages()[0];
    await page.setViewportSize({ width: 1280, height: 800 }); // 固定 viewport 稳定缓存 key
  });

  test.afterAll(async () => {
    processCacheAfterAll({
      cacheDir: CACHE_DIR,
      selectorStore: (stagehand.llmClient as any).selectorStore,
      isFullRun: true,
      usedInstructions: USED,
    });
    await browser?.close();
    await stagehand?.close();
  });

  test("用户能把商品加入购物车并进入结算页", async () => {
    // Arrange
    await page.goto("https://shop.example.com/products", { waitUntil: "domcontentloaded" });

    // Act（Stagehand 语义操作）
    await act(stagehand, "点击第一个商品卡片的 'Add to Cart' 按钮", page);
    await act(stagehand, "点击顶部购物车图标", page);

    // Assert（Playwright web-first）
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByRole("heading", { name: /cart/i })).toBeVisible();

    // Extract + 断言数据
    const item = await stagehand.extract(
      "提取购物车中第一件商品的名称和价格",
      z.object({
        name: z.string().describe("商品名称"),
        price: z.number().describe("价格数字"),
      }),
      { page }
    );
    expect(item.name).toBeTruthy();
    expect(item.price).toBeGreaterThan(0);
  });
});
```

**参考资料**：Playwright — best-practices / locators / test-assertions / test-isolation / pom；
Stagehand — basics(act/observe/extract/agent) / best-practices(prompting, caching) / ai-rules。
