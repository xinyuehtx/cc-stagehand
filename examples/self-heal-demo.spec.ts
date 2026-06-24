import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient, SelfHealTracker } from "@browserbasehq/stagehand-skill-agent";

const tracker = new SelfHealTracker({
  cacheDir: "./.stagehand-cache",
  gitBranch: "fix/e2e-self-heal",
});

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    claudeArgs: ["--project-dir", "./e2e-skills"],
    onSelfHeal: (event) => {
      tracker.record(event);
    },
  }),
  cacheDir: "./.stagehand-cache",
});

test.beforeAll(async () => {
  await stagehand.init();
});

test.afterAll(async () => {
  await stagehand.close();

  // 生成自愈报告
  const report = tracker.getReport();
  if (report.totalEvents > 0) {
    console.log(`\n自愈事件: ${report.totalEvents}`);
    console.log(`总成本: $${report.totalCostUsd}`);

    // 生成 git commit
    const commitHash = await report.generateGitCommit(
      "fix(e2e): self-heal selectors"
    );
    console.log(`Commit: ${commitHash}`);
  }
});

test("登录流程（自愈场景）", async () => {
  const page = stagehand.context.pages()[0];
  await page.goto("https://app.example.com/login");

  // 这个 act() 会触发自愈
  await stagehand.act("点击登录按钮");

  await expect(page).toHaveURL("/dashboard");
});
