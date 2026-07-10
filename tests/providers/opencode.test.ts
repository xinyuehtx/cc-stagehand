import { describe, it, expect, vi, beforeEach } from "vitest";
import { spawn, execSync } from "node:child_process";
import { OpencodeLanguageModel } from "../../src/providers/opencode.js";
import { Logger } from "../../src/logger.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => "/usr/local/bin/opencode"),
}));

describe("OpencodeLanguageModel", () => {
  let model: OpencodeLanguageModel;
  const logger = new Logger({ target: "stdout" });

  beforeEach(() => {
    vi.clearAllMocks();
    model = new OpencodeLanguageModel({
      systemPromptEnhancement: "优先使用 data-testid",
      logger,
    });
  });

  it("应该构建正确的 opencode -p 命令参数", () => {
    const args = model.buildCommandArgs(
      "You are a browser automation assistant",
      "AX Tree: [...]\nInstruction: 点击登录按钮"
    );

    expect(args).toContain("-p");
    expect(args).toContain("AX Tree: [...]\nInstruction: 点击登录按钮");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
  });

  it("应该合并 system prompt 和 enhancement", () => {
    const args = model.buildCommandArgs(
      "You are a browser automation assistant",
      "点击登录按钮"
    );

    const systemPromptIndex = args.indexOf("--append-system-prompt");
    const systemPrompt = args[systemPromptIndex + 1];

    expect(systemPrompt).toContain("You are a browser automation assistant");
    expect(systemPrompt).toContain("优先使用 data-testid");
  });

  it("应该包含 agentArgs 到命令参数中", () => {
    const modelWithArgs = new OpencodeLanguageModel({
      systemPromptEnhancement: "test",
      agentArgs: ["--model", "gpt-4"],
      logger,
    });

    const args = modelWithArgs.buildCommandArgs(undefined, "test prompt");

    expect(args).toContain("--model");
    expect(args).toContain("gpt-4");
  });

  it("spawn 被调用时应传入 opencode 二进制", async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockProcess = {
      stdout: {
        on: vi.fn((event, cb) => {
          if (event === "data") {
            cb(JSON.stringify({
              result: "Success",
              structured_output: { elementId: "0-1", method: "click", arguments: [] },
              session_id: "test-session",
              total_cost_usd: 0.001,
              cost_usd: {},
            }));
          }
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") cb(0);
      }),
    };

    mockSpawn.mockReturnValue(mockProcess as any);

    await model.generate(
      "You are a browser automation assistant",
      "点击登录按钮"
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/local/bin/opencode",
      expect.arrayContaining(["-p", "点击登录按钮"]),
      expect.any(Object)
    );
  });

  it("应该正确解析 opencode 的 JSON 响应", async () => {
    const mockSpawn = vi.mocked(spawn);
    const responseData = {
      result: "Found login button",
      structured_output: { elementId: "0-9", method: "click", arguments: [] },
      session_id: "abc-123",
      total_cost_usd: 0.003,
      cost_usd: { "gpt-4": 0.003 },
    };

    mockSpawn.mockReturnValue({
      stdout: {
        on: vi.fn((event, cb) => {
          if (event === "data") cb(JSON.stringify(responseData));
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") cb(0);
      }),
    } as any);

    const result = await model.generate(undefined, "点击登录按钮");

    expect(result.result).toBe("Found login button");
    expect(result.structured_output).toEqual({ elementId: "0-9", method: "click", arguments: [] });
    expect(result.session_id).toBe("abc-123");
    expect(result.total_cost_usd).toBe(0.003);
  });

  it("进程退出码非零时应抛出错误", async () => {
    const mockSpawn = vi.mocked(spawn);

    mockSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: {
        on: vi.fn((event, cb) => {
          if (event === "data") cb("Error: opencode command failed");
        }),
      },
      on: vi.fn((event, cb) => {
        if (event === "close") cb(1);
      }),
    } as any);

    await expect(
      model.generate(undefined, "点击登录按钮")
    ).rejects.toThrow("opencode -p exited with code 1");
  });
});
