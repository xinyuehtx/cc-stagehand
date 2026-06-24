import { writeFileSync } from "node:fs";
import type { E2ETestResult, E2EReportData } from "./types.js";

export class E2EReport {
  private tests: E2ETestResult[] = [];

  /** 添加测试结果 */
  addTest(result: E2ETestResult): void {
    this.tests.push(result);
  }

  /** 获取报告数据 */
  getData(): E2EReportData {
    const passed = this.tests.filter(t => t.status === "passed").length;
    const selfHealed = this.tests.filter(t => t.status === "self-healed").length;
    const failed = this.tests.filter(t => t.status === "failed").length;

    const totalSteps = this.tests.reduce((sum, t) => sum + t.steps.length, 0);
    const cacheHits = this.tests.reduce(
      (sum, t) => sum + t.steps.filter(s => s.cacheStatus === "hit").length,
      0
    );

    const totalClaudeCodeCalls = this.tests.reduce((sum, t) => sum + t.claudeCodeCalls, 0);
    const totalClaudeCodeCostUsd = this.tests.reduce((sum, t) => sum + t.claudeCodeCostUsd, 0);

    return {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.tests.length,
        passed,
        selfHealed,
        failed,
        cacheHitRate: totalSteps > 0 ? cacheHits / totalSteps : 0,
        totalClaudeCodeCalls,
        totalClaudeCodeCostUsd,
      },
      tests: this.tests,
    };
  }

  /** 输出到 stdout */
  printToStdout(): void {
    const data = this.getData();

    console.log("═══════════════════════════════════════════════════");
    console.log("E2E 测试报告");
    console.log("═══════════════════════════════════════════════════");
    console.log();
    console.log("📊 汇总");
    console.log(`  总测试数: ${data.summary.total}`);
    console.log(`  ✅ 成功: ${data.summary.passed} (${this.percent(data.summary.passed, data.summary.total)})`);
    console.log(`  🔄 自愈: ${data.summary.selfHealed} (${this.percent(data.summary.selfHealed, data.summary.total)})`);
    console.log(`  ❌ 失败: ${data.summary.failed} (${this.percent(data.summary.failed, data.summary.total)})`);
    console.log(`  缓存命中率: ${(data.summary.cacheHitRate * 100).toFixed(1)}%`);
    console.log(`  Claude Code 调用: ${data.summary.totalClaudeCodeCalls} 次`);
    console.log(`  Claude Code 成本: $${data.summary.totalClaudeCodeCostUsd.toFixed(4)}`);
    console.log();
    console.log("📝 测试详情");

    for (const test of data.tests) {
      const icon = test.status === "passed" ? "✅" : test.status === "self-healed" ? "🔄" : "❌";
      console.log();
      console.log(`${icon} ${test.name} (${(test.totalDurationMs / 1000).toFixed(1)}s)`);

      const cacheHits = test.steps.filter(s => s.cacheStatus === "hit").length;
      console.log(`  - 缓存命中: ${cacheHits}/${test.steps.length}`);

      if (test.claudeCodeCalls > 0) {
        console.log(`  - Claude Code 调用: ${test.claudeCodeCalls}`);
      }

      // 显示自愈详情
      const healedSteps = test.steps.filter(s => s.cacheStatus === "healed");
      if (healedSteps.length > 0) {
        for (const step of healedSteps) {
          console.log(`  - 自愈: "${step.instruction}"`);
          console.log(`    ├── 旧: ${step.oldSelector}`);
          console.log(`    ├── 新: ${step.selector}`);
          if (test.selfHealCommit) {
            console.log(`    ├── Commit: ${test.selfHealCommit}`);
          }
          console.log(`    └── 成本: $${step.durationMs}ms`);
        }
      }

      // 显示失败详情
      const failedSteps = test.steps.filter(s => s.error);
      if (failedSteps.length > 0) {
        for (const step of failedSteps) {
          console.log(`  - 失败: "${step.instruction}"`);
          console.log(`    ├── 原因: ${step.error}`);
          console.log(`    └── 建议: 人工检查并更新 CLAUDE.md`);
        }
      }
    }

    console.log();
    console.log("═══════════════════════════════════════════════════");
  }

  /** 输出到文件 */
  async writeToFile(filePath: string): Promise<void> {
    const data = this.getData();
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  /** 生成 JSON 字符串 */
  toJSON(): string {
    return JSON.stringify(this.getData(), null, 2);
  }

  /** 计算百分比 */
  private percent(value: number, total: number): string {
    if (total === 0) return "0%";
    return `${((value / total) * 100).toFixed(0)}%`;
  }
}
