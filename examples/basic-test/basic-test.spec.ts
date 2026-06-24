import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    systemPromptEnhancement: `
      ## 选择器策略
      优先使用 data-testid 属性，其次是 aria-label，最后才是 XPath。
    `,
    claudeArgs: ["--project-dir", "./examples/basic-test/e2e-skills"],
    logLevel: "info",
  }),
  cacheDir: "./.stagehand-cache",
});

test.beforeAll(async () => {
  await stagehand.init();
});

test.afterAll(async () => {
  await stagehand.close();
});

test("登录流程", async () => {
  const page = stagehand.context.pages()[0];

  // 导航到登录页面
  await page.goto("https://app.example.com/login");

  // 语义化操作（不写选择器）
  await stagehand.act("输入用户名 test@example.com");
  await stagehand.act("输入密码 password123");
  await stagehand.act("点击登录按钮");

  // 验证结果
  await expect(page).toHaveURL("/dashboard");
});
