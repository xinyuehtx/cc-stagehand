import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeLanguageModel } from "../src/claude-code-model.js";
import { Logger } from "../src/logger.js";

describe("ClaudeCodeLanguageModel", () => {
  it("应该构建正确的 claude -p 命令", () => {
    const logger = new Logger({ target: "stdout" });
    const model = new ClaudeCodeLanguageModel({
      systemPromptEnhancement: "优先使用 data-testid",
      claudeArgs: ["--model", "sonnet"],
      logger,
    });

    const args = model.buildCommandArgs(
      "You are a browser automation assistant",
      "AX Tree: [...]\nInstruction: 点击登录按钮"
    );

    expect(args).toContain("-p");
    expect(args).toContain("AX Tree: [...]\nInstruction: 点击登录按钮");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
  });

  it("应该合并 system prompt 和 enhancement", () => {
    const logger = new Logger({ target: "stdout" });
    const model = new ClaudeCodeLanguageModel({
      systemPromptEnhancement: "优先使用 data-testid",
      logger,
    });

    const args = model.buildCommandArgs(
      "You are a browser automation assistant",
      "点击登录按钮"
    );

    const systemPromptIndex = args.indexOf("--append-system-prompt");
    const systemPrompt = args[systemPromptIndex + 1];

    expect(systemPrompt).toContain("You are a browser automation assistant");
    expect(systemPrompt).toContain("优先使用 data-testid");
  });
});
