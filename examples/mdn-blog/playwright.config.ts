import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",

  /* 测试超时：LLM 调用可能较慢 */
  timeout: 180_000,

  /* 重试 1 次，触发 trace 录制 */
  retries: 1,

  /* 串行执行，避免多 worker 共享浏览器的并发问题 */
  workers: 1,

  /* Reporter 配置 */
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],

  /* 浏览器上下文配置 */
  use: {
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
