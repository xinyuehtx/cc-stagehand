import { test, expect, chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createLLMClient, generalizeCacheSelectors } from "@tengxiaohtx/stagehand-cc-agent";
import { launch } from "chrome-launcher";
import type { LaunchedChrome } from "chrome-launcher";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".stagehand-cache");
const SKILLS_DIR = join(__dirname, "e2e-skills");
const BLOG_URL = "https://developer.mozilla.org/en-US/blog/";

test.describe("Playwright 启动 Chrome + Stagehand 连接 CDP (qodercli)", () => {
  let chrome: LaunchedChrome;
  let stagehand: Stagehand;
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    // ============================================
    // 核心架构：Playwright 启动 Chrome → Stagehand 连接 CDP
    // ============================================

    // 1. 使用 chrome-launcher 启动 Chrome
    chrome = await launch({
      chromeFlags: [
        "--headless=new",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
      ],
      port: 0, // 自动分配端口
    });

    const debugPort = chrome.port;
    console.log(`Chrome 已启动，调试端口: ${debugPort}`);

    // 2. 获取 CDP WebSocket URL
    const versionRes = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    const versionData = (await versionRes.json()) as { webSocketDebuggerUrl: string };
    const cdpWsUrl = versionData.webSocketDebuggerUrl;
    console.log(`CDP WebSocket URL: ${cdpWsUrl}`);

    // 3. Playwright 通过 CDP 连接到浏览器
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);

    // 4. 创建 LLM Client（使用 qodercli Agent）
    const llmClient = createLLMClient({
      agentType: "qodercli",
      cwd: SKILLS_DIR,
      timeout: 120_000,
      logLevel: "debug",
      systemPromptEnhancement: `
## 选择器策略
优先使用语义化 CSS 选择器（HTML 语义标签 + BEM class），
避免使用 xpath 和过于具体的复合选择器。
      `,
    });

    // 5. Stagehand 通过 CDP URL 连接到同一浏览器
    stagehand = new Stagehand({
      env: "LOCAL",
      llmClient,
      cacheDir: CACHE_DIR,
      localBrowserLaunchOptions: {
        cdpUrl: cdpWsUrl, // 连接到已启动的 Chrome
      },
    });
    await stagehand.init();

    // 6. 获取 Playwright page
    const defaultContext = browser.contexts()[0];
    page = defaultContext.pages()[0] ?? (await defaultContext.newPage());
  });

  test.afterAll(async () => {
    // 后处理：泛化缓存中的选择器
    if (stagehand) {
      const llmClient = stagehand.llmClient as any;
      if (llmClient?.selectorStore) {
        const result = generalizeCacheSelectors({
          cacheDir: CACHE_DIR,
          selectorStore: llmClient.selectorStore,
        });
        console.log(
          `缓存后处理完成: ${result.updatedSelectors} 个选择器已泛化, ${result.skippedSelectors} 个跳过`
        );
      }
    }

    // 关闭顺序：Stagehand → Playwright → Chrome
    if (stagehand) {
      await stagehand.close();
    }
    if (browser) {
      await browser.close();
    }
    if (chrome) {
      await chrome.kill();
    }
  });

  test("博客列表页可访问且包含文章卡片", async () => {
    await page.goto(BLOG_URL, { waitUntil: "domcontentloaded" });
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
    console.log(`提取到 ${cards.length} 篇博客卡片`);
  });

  test("点击 Read more 进入博客详情", async () => {
    // Stagehand 语义操作
    await stagehand.act("点击第一个博客卡片的 Read more 按钮", { page });

    // Playwright 等待导航
    await page.waitForLoadState("domcontentloaded");

    // Playwright 断言
    await expect(page).toHaveURL(/\/blog\/.+/);
    expect(page.url()).not.toBe(BLOG_URL);

    // Stagehand 语义提取
    const content = await stagehand.extract(
      "提取页面中博客文章的主要内容文本（不包括导航、页脚等）",
      z.object({
        articleContent: z.string().describe("博客文章的主要正文文本内容"),
      }),
      { page }
    );

    expect(content.articleContent).toBeTruthy();
    expect(content.articleContent.length).toBeGreaterThan(50);
    console.log(`文章内容长度: ${content.articleContent.length} 字符`);
  });
});
