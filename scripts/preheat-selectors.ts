import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";
import { readdirSync } from "node:fs";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    claudeArgs: ["--project-dir", "./e2e-skills"],
    logLevel: "info",
  }),
  cacheDir: "./.stagehand-cache",
});

async function preheat() {
  await stagehand.init();

  const page = stagehand.context.pages()[0];

  // 登录页面
  await page.goto("https://app.example.com/login");
  await stagehand.act("输入用户名");
  await stagehand.act("输入密码");
  await stagehand.act("点击登录按钮");

  // 商品页面
  await page.goto("https://app.example.com/products");
  await stagehand.act("点击搜索框");
  await stagehand.act("输入搜索关键词");
  await stagehand.act("点击搜索按钮");

  // 结算页面
  await page.goto("https://app.example.com/checkout");
  await stagehand.act("输入配送地址");
  await stagehand.act("选择支付方式");
  await stagehand.act("点击支付按钮");

  await stagehand.close();

  console.log("缓存预热完成！");
  console.log("缓存文件:", readdirSync("./.stagehand-cache"));
}

preheat().catch(console.error);
