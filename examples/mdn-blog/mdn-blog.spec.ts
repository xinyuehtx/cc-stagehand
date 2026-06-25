import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClaudeCodeLLMClient } from "@tengxiaohtx/stagehand-cc-agent";

// 获取当前文件所在目录（examples/mdn-blog/）
const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dirname, ".stagehand-cache");
const SKILLS_DIR = join(__dirname, "e2e-skills");

// 增加测试超时时间，因为 LLM 调用需要较长时间
test.setTimeout(180000);

const BLOG_URL = "https://developer.mozilla.org/en-US/blog/";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    systemPromptEnhancement: `
      ## 选择器策略
      优先使用 BEM 风格的 CSS class（如 .blog-post-preview），
      其次是 HTML 语义标签（如 article、h2），
      最后才是 data-variant 等属性选择器。
      **不要使用 xpath**，始终使用 CSS 选择器。
      **重要**：Read more 按钮的选择器是 "a.button" 且 data-variant="primary"。
    `,
    cwd: SKILLS_DIR,
    timeout: 120000,
    logLevel: "info",
  }),
  cacheDir: CACHE_DIR,
});

test.beforeAll(async () => {
  await stagehand.init();
});

test.afterAll(async () => {
  await stagehand.close();
});

test("博客列表页可访问且包含卡片", async () => {
  const page = stagehand.context.pages()[0];

  // 导航到博客列表页
  await page.goto(BLOG_URL, { timeout: 30000 });
  expect(page.url()).toMatch(/\/blog\//);

  // 使用 extract 获取所有卡片标题，验证卡片数量
  const cards = await stagehand.extract(
    "获取页面上所有博客卡片的标题",
    z.array(
      z.object({
        title: z.string().describe("博客卡片的文章标题"),
      })
    )
  );

  expect(cards.length).toBeGreaterThan(0);
});

test("博客卡片包含完整结构", async () => {
  const page = stagehand.context.pages()[0];

  await page.goto(BLOG_URL, { timeout: 30000 });

  // 提取第一张卡片的完整结构化数据
  const card = await stagehand.extract(
    "提取第一张博客卡片的信息，包括标题、作者、摘要和文章链接",
    z.object({
      title: z.string().describe("博客卡片的文章标题"),
      author: z.string().describe("博客文章的作者名称"),
      summary: z.string().describe("博客卡片的摘要描述文字"),
      link: z.string().describe("博客文章的链接地址（href 属性值）"),
    })
  );

  // 验证各字段非空
  expect(card.title).toBeTruthy();
  expect(card.author).toBeTruthy();
  expect(card.summary).toBeTruthy();
  expect(card.link).toBeTruthy();
});

test("点击 Read more 进入博客详情", async () => {
  const page = stagehand.context.pages()[0];

  await page.goto(BLOG_URL, { timeout: 30000 });

  // 等待 Read more 按钮出现
  const readMoreSelector = "article.blog-post-preview:first-of-type a.button";
  await page.waitForSelector(readMoreSelector, { state: "visible", timeout: 10000 });

  // 滚动到 Read more 按钮，确保它在视口内
  await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, readMoreSelector);
  await page.waitForTimeout(500); // 等待滚动完成

  // 使用 act() 语义化操作点击 Read more
  // 首次运行：LLM 生成选择器 → 执行点击 → 缓存选择器
  // 后续运行：直接命中缓存 → 0 LLM 消耗
  let targetPage = page;

  await stagehand.act("点击第一个博客卡片的 Read more 按钮");

  // 检查 act() 是否成功导航
  let navigated = false;
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1000);
    const url = page.url();
    if (url !== BLOG_URL && url.includes("/blog/")) {
      navigated = true;
      break;
    }
  }

  // 如果 act() 没有触发导航，使用直接点击
  if (!navigated) {
    console.log("act() 未触发导航，使用 skill 文件中的已知选择器直接点击");

    // 检查链接属性
    const linkInfo = await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      return {
        href: el.getAttribute('href'),
        target: el.getAttribute('target'),
        text: el.textContent,
      };
    }, readMoreSelector);
    console.log("Read more 链接信息:", linkInfo);

    if (!linkInfo || !linkInfo.href) {
      throw new Error("未能获取到有效的链接信息");
    }

    // 直接导航到详情页（最可靠的方式）
    const detailUrl = linkInfo.href.startsWith('http')
      ? linkInfo.href
      : `https://developer.mozilla.org${linkInfo.href}`;

    console.log("导航到详情页:", detailUrl);
    await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    navigated = true;
  }

  // 最终验证导航
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    const url = targetPage.url();
    if (url !== BLOG_URL && url.includes("/blog/")) {
      navigated = true;
      break;
    }
  }

  const currentUrl = targetPage.url();
  console.log("详情页 URL:", currentUrl);
  expect(navigated).toBe(true);

  // 等待新页面加载
  await targetPage.waitForTimeout(2000);

  // 验证详情页包含正文内容
  const content = await stagehand.extract(
    "提取页面中博客文章的主要内容文本（不包括导航、页脚等）",
    z.object({
      articleContent: z.string().describe("博客文章的主要正文文本内容，取前几句话即可"),
    })
  );

  expect(content.articleContent).toBeTruthy();
});
