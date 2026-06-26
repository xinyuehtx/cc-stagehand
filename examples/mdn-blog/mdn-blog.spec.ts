import { test, expect, chromium } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClaudeCodeLLMClient, generalizeCacheSelectors } from "@tengxiaohtx/stagehand-cc-agent";

/* ---- 路径常量 ---- */
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".stagehand-cache");
const SKILLS_DIR = join(__dirname, "e2e-skills");
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
        logLevel: "debug",
      }),
      cacheDir: CACHE_DIR,
    });
    await stagehand.init();

    // 2. 获取 CDP WebSocket URL 并通过 Playwright 连接
    const cdpUrl = stagehand.connectURL();
    browser = await chromium.connectOverCDP(cdpUrl);
  });

  test.afterAll(async () => {
    // 后处理：将缓存中的 xpath 替换为语义化 CSS 选择器
    if (stagehand) {
      const llmClient = stagehand.llmClient as unknown as { selectorStore: import("@tengxiaohtx/stagehand-cc-agent").SelectorStore };
      const result = generalizeCacheSelectors({
        cacheDir: CACHE_DIR,
        selectorStore: llmClient.selectorStore,
      });
      console.log(
        `缓存后处理完成: ${result.updatedSelectors} 个选择器已泛化, ${result.skippedSelectors} 个跳过`
      );
    }

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
