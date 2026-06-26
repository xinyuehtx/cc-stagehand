# SPEC: Playwright 测试框架集成技术规格

**版本：** 1.0  
**状态：** 已批准  
**日期：** 2026-06-26  
**依赖 RFC：** [Playwright Integration RFC](./rfc.md)（已批准）

---

## 1. 概述

本 SPEC 定义了将 `examples/mdn-blog/` 示例从 Vitest 迁移到 `@playwright/test` 的完整技术规格。

**核心架构：**
- Stagehand 创建浏览器实例，通过 `connectURL()` 暴露 CDP WebSocket URL
- Playwright 通过 `connectOverCDP()` 连接同一浏览器
- Playwright 管理页面生命周期（创建、导航、断言）
- Stagehand 的 `act()`/`extract()` 接收 `{ page }` 参数，操作 Playwright 管理的页面

**变更范围：**
- 仅涉及 `examples/mdn-blog/` 目录下的文件
- 核心库 `src/` 不做任何修改
- 新增 Playwright 配置、重写测试文件

---

## 2. 文件结构

```
examples/mdn-blog/
├── playwright.config.ts        # 新增 — Playwright 配置
├── mdn-blog.spec.ts            # 重写 — Vitest → Playwright
├── e2e-skills/
│   └── CLAUDE.md               # 不变
├── package.json                # 修改 — 更新依赖和 scripts
├── .cdp-url.tmp                # 新增（运行时生成，.gitignore 忽略）
├── .stagehand-cache/           # 不变（可提交到 Git）
├── test-results/               # 新增（运行时生成，.gitignore 忽略）
├── playwright-report/          # 新增（运行时生成，.gitignore 忽略）
└── vitest.config.ts            # 删除
```

---

## 3. playwright.config.ts

```typescript
// examples/mdn-blog/playwright.config.ts
import { defineConfig } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_URL_FILE = resolve(__dirname, ".cdp-url.tmp");

/**
 * 从 .cdp-url.tmp 文件读取 CDP URL
 * 该文件由测试的 beforeAll 写入
 */
function getCdpUrl(): string | undefined {
  if (!existsSync(CDP_URL_FILE)) {
    return undefined;
  }
  return readFileSync(CDP_URL_FILE, "utf-8").trim();
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",

  /* 测试超时：LLM 调用可能较慢 */
  timeout: 180_000,

  /* 重试 1 次，触发 trace 录制 */
  retries: 1,

  /* 串行执行，避免多 worker 各自启动 Chrome */
  workers: 1,

  /* Reporter 配置 */
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],

  /* 浏览器上下文配置 */
  use: {
    /* CDP 连接到 Stagehand 启动的浏览器 */
    cdpUrl: getCdpUrl(),

    /* Trace: 首次重试时录制完整 trace */
    trace: "on-first-retry",

    /* Screenshot: 仅失败时截图 */
    screenshot: "only-on-failure",

    /* 不录制视频 */
    video: "off",

    /* 页面导航超时 */
    navigationTimeout: 30_000,
  },
});
```

**关键设计决策：**

| 配置项 | 值 | 理由 |
|--------|-----|------|
| `workers` | `1` | 串行执行，每个测试文件的 `beforeAll` 启动独立 Stagehand |
| `retries` | `1` | 启用重试以触发 `trace: "on-first-retry"` |
| `timeout` | `180_000` | 首次运行时 LLM 调用可能耗时 2-3 分钟 |
| `cdpUrl` | 从文件读取 | `beforeAll` 写入，config 加载时读取 |
| `trace` | `on-first-retry` | 仅在重试时录制，减少存储开销 |
| `screenshot` | `only-on-failure` | 仅失败时截图 |

**cdpUrl 时序说明：**

1. `playwright.config.ts` 在 Playwright 主进程启动时加载
2. 此时 `.cdp-url.tmp` 文件不存在，`getCdpUrl()` 返回 `undefined`
3. Playwright 启动 worker 进程，执行 `beforeAll`
4. `beforeAll` 中 Stagehand 启动 Chrome，写入 `.cdp-url.tmp`
5. **问题：** Playwright 的 `browser` fixture 在 config 加载时已尝试连接 CDP

**解决方案：不使用 `use.cdpUrl`，改为在测试中手动连接**

```typescript
// 修改后的 playwright.config.ts — 移除 cdpUrl
export default defineConfig({
  // ...其他配置不变
  use: {
    // 不设置 cdpUrl，由测试代码手动连接
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    navigationTimeout: 30_000,
  },
});
```

---

## 4. mdn-blog.spec.ts

```typescript
// examples/mdn-blog/mdn-blog.spec.ts
import { test, expect, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createClaudeCodeLLMClient } from "@tengxiaohtx/stagehand-cc-agent";

/* ---- 路径常量 ---- */
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".stagehand-cache");
const SKILLS_DIR = join(__dirname, "e2e-skills");
const CDP_URL_FILE = resolve(__dirname, ".cdp-url.tmp");
const BLOG_URL = "https://developer.mozilla.org/en-US/blog/";

/* ---- 测试套件 ---- */
test.describe("MDN Blog E2E Tests", () => {
  let stagehand: Stagehand;
  let browser: Browser;

  test.beforeAll(async () => {
    // 1. Stagehand 创建浏览器
    stagehand = new Stagehand({
      env: "LOCAL",
      llmClient: createClaudeCodeLLMClient({
        systemPromptEnhancement: `
          ## 选择器策略
          优先使用语义化 CSS 选择器（如 BEM class 或 HTML 语义标签），
          避免使用 xpath 和过于具体的复合选择器。
        `,
        cwd: SKILLS_DIR,
        timeout: 120_000,
        logLevel: "info",
      }),
      cacheDir: CACHE_DIR,
    });
    await stagehand.init();

    // 2. 获取 CDP WebSocket URL 并通过 Playwright 连接
    const cdpUrl = stagehand.connectURL();
    browser = await chromium.connectOverCDP(cdpUrl);
  });

  test.afterAll(async () => {
    // 关闭 Playwright 连接（不关闭浏览器）
    if (browser) {
      await browser.close();
    }
    // 关闭 Stagehand（同时关闭 Chrome）
    if (stagehand) {
      await stagehand.close();
    }
  });

  test("博客列表页可访问且包含卡片", async () => {
    // Playwright 管理页面
    const page = await browser.newPage();

    try {
      await page.goto(BLOG_URL);
      await expect(page).toHaveURL(/\/blog\//);

      // Stagehand 语义提取 — 传入 Playwright page
      const cards = await stagehand.extract(
        "获取页面上所有博客卡片的标题",
        z.array(
          z.object({
            title: z.string().describe("博客卡片的文章标题"),
          })
        ),
        { page }
      );

      expect(cards.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  });

  test("博客卡片包含完整结构", async () => {
    const page = await browser.newPage();

    try {
      await page.goto(BLOG_URL);

      // Stagehand 语义提取 — 传入 Playwright page
      const card = await stagehand.extract(
        "提取第一张博客卡片的信息，包括标题、作者、摘要和文章链接",
        z.object({
          title: z.string().describe("博客卡片的文章标题"),
          author: z.string().describe("博客文章的作者名称"),
          summary: z.string().describe("博客卡片的摘要描述文字"),
          link: z.string().describe("博客文章的链接地址（href 属性值）"),
        }),
        { page }
      );

      expect(card.title).toBeTruthy();
      expect(card.author).toBeTruthy();
      expect(card.summary).toBeTruthy();
      expect(card.link).toBeTruthy();
    } finally {
      await page.close();
    }
  });

  test("点击 Read more 进入博客详情", async () => {
    const page = await browser.newPage();

    try {
      await page.goto(BLOG_URL);

      // Stagehand 语义操作 — 传入 Playwright page
      // 首次运行：LLM 生成选择器 → 执行点击 → 缓存选择器
      // 后续运行：直接命中缓存 → 零 LLM 消耗
      await stagehand.act("点击第一个博客卡片的 Read more 按钮", { page });

      // Playwright 等待导航完成
      await page.waitForLoadState("domcontentloaded");

      // Playwright 断言
      await expect(page).toHaveURL(/\/blog\/.+/);
      expect(page.url()).not.toBe(BLOG_URL);

      // Stagehand 语义提取 — 传入 Playwright page
      const content = await stagehand.extract(
        "提取页面中博客文章的主要内容文本（不包括导航、页脚等）",
        z.object({
          articleContent: z
            .string()
            .describe("博客文章的主要正文文本内容，取前几句话即可"),
        }),
        { page }
      );

      expect(content.articleContent).toBeTruthy();
    } finally {
      await page.close();
    }
  });
});
```

**Vitest → Playwright 迁移对照：**

| Vitest | Playwright | 说明 |
|--------|-----------|------|
| `import { describe, test, expect, beforeAll, afterAll, vi } from "vitest"` | `import { test, expect, chromium } from "@playwright/test"` | 测试框架导入 |
| `describe("...", () => {...})` | `test.describe("...", () => {...})` | 测试套件 |
| `test("...", async () => {...})` | `test("...", async () => {...})` | 测试用例 |
| `beforeAll(async () => {...})` | `test.beforeAll(async () => {...})` | 前置钩子 |
| `afterAll(async () => {...})` | `test.afterAll(async () => {...})` | 后置钩子 |
| `stagehand.context.pages()[0]` | `await browser.newPage()` | 页面获取方式 |
| `page.goto(url, { timeoutMs })` | `page.goto(url)` | 导航 |
| `page.waitForLoadState("domcontentloaded")` | `page.waitForLoadState("domcontentloaded")` | 不变 |
| `expect(page.url()).toMatch(...)` | `await expect(page).toHaveURL(...)` | Playwright 异步断言 |
| `stagehand.act("...")` | `stagehand.act("...", { page })` | 传入 Playwright page |
| `stagehand.extract("...", schema)` | `stagehand.extract("...", schema, { page })` | 传入 Playwright page |

**页面生命周期：**
- `beforeAll`：创建 Stagehand + 启动 Chrome + Playwright 连接 CDP
- 每个 test：`browser.newPage()` → 使用 → `page.close()`
- `afterAll`：关闭 Playwright 连接 + 关闭 Stagehand（关闭 Chrome）

---

## 5. package.json 变更

```json
{
  "name": "@tengxiaohtx/stagehand-cc-agent-example-mdn-blog",
  "version": "0.1.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed",
    "test:report": "playwright show-report"
  },
  "dependencies": {
    "@tengxiaohtx/stagehand-cc-agent": "workspace:*",
    "@browserbasehq/stagehand": "^3.6.0",
    "@playwright/test": "^1.61.1",
    "zod": "^3.25.76"
  }
}
```

**scripts 变更：**

| 命令 | 旧 (Vitest) | 新 (Playwright) |
|------|------------|----------------|
| `npm test` | `vitest run` | `playwright test` |
| `npm run test:ui` | — | `playwright test --ui` |
| `npm run test:headed` | — | `playwright test --headed` |
| `npm run test:report` | — | `playwright show-report` |

---

## 6. .gitignore 新增条目

```gitignore
# Playwright
test-results/
playwright-report/
blob-report/
playwright/.cache/

# CDP URL 临时文件
.cdp-url.tmp
examples/**/.cdp-url.tmp
```

---

## 7. Stagehand `connectURL()` 时序

```
test.beforeAll()
    │
    ├── new Stagehand({ env: "LOCAL", ... })
    │
    ├── stagehand.init()
    │   → Chrome 启动（chrome-launcher）
    │   → V3Context 创建
    │   → CDP 连接建立
    │
    ├── stagehand.connectURL()
    │   → 返回 "ws://127.0.0.1:PORT/devtools/browser/..."
    │
    └── chromium.connectOverCDP(cdpUrl)
        → Playwright 连接同一浏览器
        → Playwright 可以创建/管理页面

test("...", async () => {
    │
    ├── browser.newPage()
    │   → Playwright 创建新页面
    │   → Stagehand 通过 CDP target auto-attach 看到此页面
    │
    ├── page.goto(BLOG_URL)
    │   → Playwright 导航页面
    │
    ├── stagehand.act("...", { page })
    │   → Stagehand 检测 Playwright page（isPlaywrightPage）
    │   → 创建 CDP session: page.context().newCDPSession(page)
    │   → 获取 frame tree: cdp.send("Page.getFrameTree")
    │   → 提取 top frame ID: frameTree.frame.id
    │   → 桥接到 V3 Page: ctx.resolvePageByMainFrameId(frameId)
    │   → 在 V3 Page 上执行 act()
    │
    ├── expect(page).toHaveURL(...)
    │   → Playwright 断言
    │
    └── page.close()
        → Playwright 关闭页面

test.afterAll()
    │
    ├── browser.close()
    │   → 关闭 Playwright CDP 连接（不关闭 Chrome）
    │
    └── stagehand.close()
        → 关闭 Chrome 进程
```

---

## 8. 缓存条目格式（不变）

Stagehand 的 `ActCache` 格式保持不变：

```typescript
interface CachedActEntry {
  version: 1;
  instruction: string;          // "点击第一个博客卡片的 Read more 按钮"
  url: string;                  // "https://developer.mozilla.org/en-US/blog/"
  variableKeys: string[];       // []
  actions: Array<{
    selector: string;           // 语义化选择器
    description: string;        // 操作描述
    method?: string;            // "click" | "fill" | ...
    arguments?: string[];
  }>;
  actionDescription: string;
  message: string;
}
```

---

## 9. Playwright Report 输出

```
playwright-report/
└── index.html                  # HTML 报告（可浏览器打开）

test-results/
├── results.json                # JSON 格式测试结果
├── mdn-blog-博客列表页可访问且包含卡片-chromium/
│   ├── trace.zip               # trace 文件（重试时录制）
│   └── test-failed-1.png       # 失败截图（如果有）
└── mdn-blog-点击-Read-more-进入博客详情-chromium/
    ├── trace.zip
    └── test-failed-1.png
```

---

## 10. 错误处理

### 10.1 Stagehand init() 失败

```typescript
test.beforeAll(async () => {
  try {
    stagehand = new Stagehand({...});
    await stagehand.init();
    const cdpUrl = stagehand.connectURL();
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (error) {
    console.error("Stagehand init or Playwright connect failed:", error);
    throw error; // 测试会被标记为失败
  }
});
```

### 10.2 Stagehand act/extract 页面桥接失败

```typescript
// Stagehand 内部处理：
// 1. isPlaywrightPage(page) → true（检测 page.context 是否为函数）
// 2. cdp = await page.context().newCDPSession(page)
// 3. { frameTree } = await cdp.send("Page.getFrameTree")
// 4. frameId = frameTree.frame.id
// 5. v3Page = ctx.resolvePageByMainFrameId(frameId)
//    → 如果找不到，抛出 StagehandInitError
```

### 10.3 afterAll 容错

```typescript
test.afterAll(async () => {
  try {
    if (browser) await browser.close();
  } catch (error) {
    console.warn("Playwright browser close failed:", error);
  }
  try {
    if (stagehand) await stagehand.close();
  } catch (error) {
    console.warn("Stagehand close failed:", error);
  }
});
```

---

## 11. 性能考量

### 11.1 启动开销

| 步骤 | 耗时估算 |
|------|---------|
| Stagehand `init()` (Chrome 启动) | ~1-2s |
| Playwright `connectOverCDP()` | ~200ms |
| `browser.newPage()` | ~100ms |
| 首次 `act()` (LLM 调用) | ~2-5s |
| 缓存命中 `act()` | ~50-200ms |

### 11.2 缓存回放性能

- 第二次运行时，所有 `act()` 调用命中缓存
- 每个缓存命中约 50-200ms（纯 CDP 确定性操作）
- 与原生 Playwright 测试速度相当（额外开销 < 10%）

---

## 12. 兼容性

### 12.1 依赖版本

| 依赖 | 最低版本 | 推荐版本 |
|------|---------|---------|
| `@playwright/test` | ^1.50.0 | ^1.61.1 |
| `@browserbasehq/stagehand` | ^3.6.0 | ^3.6.0 |
| Node.js | >= 18 | >= 20 |

### 12.2 向后兼容

- 核心库 `src/` 不受影响
- 其他示例（`examples/basic-test/`、`examples/self-heal/`）可继续使用 Vitest
- 根目录的 `vitest.config.ts` 不变（用于单元测试）

---

**文档结束**
