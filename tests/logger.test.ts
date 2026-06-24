import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../src/logger.js";
import { appendFileSync, mkdirSync } from "node:fs";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("应该在 CI 环境输出到 stdout", () => {
    process.env.CI = "true";

    const logger = new Logger({ level: "info", target: "auto" });
    const stdoutSpy = vi.spyOn(process.stdout, "write");

    logger.info("Test message", { key: "value" });

    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("[INFO] Test message")
    );
  });

  it("应该在本地环境输出到文件", () => {
    const logger = new Logger({
      level: "info",
      target: "auto",
      filePath: "./.stagehand-logs/test.log",
    });

    logger.info("Test message", { key: "value" });

    expect(appendFileSync).toHaveBeenCalledWith(
      "./.stagehand-logs/test.log",
      expect.stringContaining("[INFO] Test message")
    );
  });

  it("应该尊重日志级别", () => {
    const logger = new Logger({ level: "warn", target: "stdout" });
    const stdoutSpy = vi.spyOn(process.stdout, "write");

    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");

    expect(stdoutSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Debug message")
    );
    expect(stdoutSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Info message")
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warn message")
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error message")
    );
  });
});
