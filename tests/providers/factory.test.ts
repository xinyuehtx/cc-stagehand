import { describe, it, expect, vi } from "vitest";
import { createLanguageModelProvider } from "../../src/providers/factory.js";
import { ClaudeCodeLanguageModel } from "../../src/claude-code-model.js";
import { OpencodeLanguageModel } from "../../src/providers/opencode.js";
import { QodercliLanguageModel } from "../../src/providers/qodercli.js";
import { Logger } from "../../src/logger.js";

// Mock child_process to prevent resolveXxxBin() from actually running commands
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => ""),
}));

describe("createLanguageModelProvider", () => {
  const logger = new Logger({ target: "stdout" });
  const baseOptions = {
    systemPromptEnhancement: "test enhancement",
    logger,
  };

  it("type 为 claude 时返回 ClaudeCodeLanguageModel 实例", () => {
    const provider = createLanguageModelProvider("claude", baseOptions);
    expect(provider).toBeInstanceOf(ClaudeCodeLanguageModel);
    expect(provider.type).toBe("claude");
  });

  it("type 为 opencode 时返回 OpencodeLanguageModel 实例", () => {
    const provider = createLanguageModelProvider("opencode", baseOptions);
    expect(provider).toBeInstanceOf(OpencodeLanguageModel);
    expect(provider.type).toBe("opencode");
  });

  it("type 为 qodercli 时返回 QodercliLanguageModel 实例", () => {
    const provider = createLanguageModelProvider("qodercli", baseOptions);
    expect(provider).toBeInstanceOf(QodercliLanguageModel);
    expect(provider.type).toBe("qodercli");
  });

  it("传入不支持的 type 时应抛出错误", () => {
    expect(() =>
      createLanguageModelProvider("unsupported" as any, baseOptions)
    ).toThrow("Unsupported agent type: unsupported");
  });
});
