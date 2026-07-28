/**
 * site-capture.spec.ts — 文档站点截图生成脚本
 *
 * 运行真实的 Stagehand + Claude Code + Playwright 流程，
 * 在关键步骤截取「真实使用效果」截图，输出到 docs/assets/screenshots。
 *
 * 该文件不属于常规回归测试，仅用于生成介绍网站素材：
 *   cd examples/mdn-blog
 *   npx playwright test site-capture.spec.ts
 *
 * 依赖：claude CLI 已登录、可访问 developer.mozilla.org。
 */
import { test, expect, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClaudeCodeLLMClient, processCacheAfterAll } from "@tengxiaohtx/stagehand-cc-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".stagehand-cache");
const SKILLS_DIR = join(__dirname, "e2e-skills");
const SHOTS_DIR = join(__dirname, "../../docs/assets/screenshots");
const BLOG_URL = "https://developer.mozilla.org/en-US/blog/";

mkdirSync(SHOTS_DIR, { recursive: true });

test.describe("Site screenshot capture", () => {
  let stagehand: Stagehand;
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
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

    const cdpUrl = stagehand.connectURL();
    browser = await chromium.connectOverCDP(cdpUrl);
    const defaultContext = browser.contexts()[0];
    page = defaultContext.pages()[0];
    await page.setViewportSize({ width: 1280, height: 860 });
  });

  test.afterAll(async () => {
    if (stagehand) {
      const llmClient = stagehand.llmClient as any;
      if (llmClient?.selectorStore) {
        const result = processCacheAfterAll({
          cacheDir: CACHE_DIR,
          selectorStore: llmClient.selectorStore,
          isFullRun: true,
          ttlSeconds: 30 * 24 * 3600,
        });
        // 导出一份 manifest/selector 摘要，供网站展示缓存效果
        writeFileSync(
          join(SHOTS_DIR, "capture-summary.json"),
          JSON.stringify(result, null, 2)
        );
      }
    }
    if (browser) await browser.close();
    if (stagehand) await stagehand.close();
  });

  test("capture blog list + semantic extract", async () => {
    await page.goto(BLOG_URL, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/blog\//);
    await page.waitForTimeout(1500);

    // 截图 1：博客列表页
    await page.screenshot({
      path: join(SHOTS_DIR, "01-blog-list.png"),
      fullPage: false,
    });

    // 语义提取：真实的 extract() 调用
    const cards = await stagehand.extract(
      "获取页面上所有博客卡片的标题",
      z.array(z.object({ title: z.string().describe("博客卡片的文章标题") })),
      { page }
    );
    expect(cards.length).toBeGreaterThan(0);
    writeFileSync(
      join(SHOTS_DIR, "extract-cards.json"),
      JSON.stringify(cards.slice(0, 6), null, 2)
    );
  });

  test("capture semantic act -> article detail", async () => {
    // 真实的 act() 调用：Claude Code 生成选择器并点击
    await stagehand.act("点击第一个博客卡片的 Read more 按钮", { page });
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/\/blog\/.+/);
    await page.waitForTimeout(1500);

    // 截图 2：文章详情页
    await page.screenshot({
      path: join(SHOTS_DIR, "02-article-detail.png"),
      fullPage: false,
    });
  });
});
