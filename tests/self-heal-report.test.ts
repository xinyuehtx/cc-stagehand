import { describe, it, expect } from "vitest";
import { SelfHealTracker } from "../src/self-heal.js";
import { E2EReport } from "../src/report.js";
import type { SelfHealEvent, E2ETestResult } from "../src/types.js";

describe("SelfHealTracker", () => {
  it("应该记录自愈事件并生成报告", () => {
    const tracker = new SelfHealTracker();

    const event: SelfHealEvent = {
      testName: "登录流程",
      instruction: "点击登录按钮",
      oldSelector: "[data-testid='login-btn']",
      newSelector: "[aria-label='Sign In']",
      reason: "Element not found",
      durationMs: 2100,
      costUsd: 0.003,
      timestamp: new Date().toISOString(),
    };

    tracker.record(event);

    const report = tracker.getReport();
    expect(report.totalEvents).toBe(1);
    expect(report.events).toHaveLength(1);
    expect(report.totalCostUsd).toBe(0.003);
    expect(report.events[0].instruction).toBe("点击登录按钮");
  });

  it("应该清空事件", () => {
    const tracker = new SelfHealTracker();

    tracker.record({
      testName: "test",
      instruction: "test",
      oldSelector: "old",
      newSelector: "new",
      reason: "test",
      durationMs: 100,
      costUsd: 0.001,
      timestamp: new Date().toISOString(),
    });

    expect(tracker.getReport().totalEvents).toBe(1);

    tracker.clear();

    expect(tracker.getReport().totalEvents).toBe(0);
  });
});

describe("E2EReport", () => {
  it("应该添加测试结果并生成报告", () => {
    const report = new E2EReport();

    report.addTest({
      name: "登录流程",
      status: "passed",
      steps: [
        {
          instruction: "输入用户名",
          cacheStatus: "hit",
          selector: "[data-testid='email']",
          durationMs: 23,
        },
        {
          instruction: "点击登录按钮",
          cacheStatus: "hit",
          selector: "[data-testid='login-btn']",
          durationMs: 45,
        },
      ],
      totalDurationMs: 1500,
      claudeCodeCalls: 0,
      claudeCodeCostUsd: 0,
    });

    report.addTest({
      name: "结算流程",
      status: "self-healed",
      steps: [
        {
          instruction: "点击支付按钮",
          cacheStatus: "healed",
          selector: "[aria-label='Pay']",
          oldSelector: "[data-testid='pay']",
          durationMs: 3200,
        },
      ],
      selfHealCommit: "abc123",
      totalDurationMs: 3200,
      claudeCodeCalls: 1,
      claudeCodeCostUsd: 0.003,
    });

    const data = report.getData();

    expect(data.summary.total).toBe(2);
    expect(data.summary.passed).toBe(1);
    expect(data.summary.selfHealed).toBe(1);
    expect(data.summary.failed).toBe(0);
    expect(data.summary.cacheHitRate).toBeCloseTo(2 / 3);
    expect(data.summary.totalClaudeCodeCalls).toBe(1);
    expect(data.summary.totalClaudeCodeCostUsd).toBe(0.003);
  });

  it("应该输出 JSON", () => {
    const report = new E2EReport();

    report.addTest({
      name: "test",
      status: "passed",
      steps: [],
      totalDurationMs: 100,
      claudeCodeCalls: 0,
      claudeCodeCostUsd: 0,
    });

    const json = report.toJSON();
    const parsed = JSON.parse(json);

    expect(parsed.summary.total).toBe(1);
    expect(parsed.tests).toHaveLength(1);
  });
});
