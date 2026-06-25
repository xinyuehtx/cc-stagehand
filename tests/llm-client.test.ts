import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClaudeCodeLLMClient } from "../src/llm-client.js";
import { spawn } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("ClaudeCodeLLMClient", () => {
  let client: ReturnType<typeof createClaudeCodeLLMClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createClaudeCodeLLMClient({
      systemPromptEnhancement: "优先使用 data-testid",
      cwd: "./e2e-skills",
      logTarget: "stdout",
    });
  });

  it("应该提取 Stagehand 的 messages", async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockStdout = {
      on: vi.fn((event, cb) => {
        if (event === "data") {
          cb(JSON.stringify({
            result: "Success",
            structured_output: {
              elementId: "0-1",
              method: "click",
              arguments: [],
            },
            session_id: "test-session",
            total_cost_usd: 0.001,
            cost_usd: { "claude-3-5-sonnet": 0.001 },
          }));
        }
      }),
    };

    mockSpawn.mockReturnValue({
      stdout: mockStdout,
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") {
          cb(0);
        }
      }),
    } as any);

    await client.createChatCompletion({
      options: {
        messages: [
          { role: "system", content: "You are a browser automation assistant" },
          { role: "user", content: "AX Tree: [...]\nInstruction: 点击登录按钮" },
        ],
      },
      logger: () => {},
    });

    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "AX Tree: [...]\nInstruction: 点击登录按钮",
        "--append-system-prompt",
        expect.stringContaining("You are a browser automation assistant"),
      ]),
      expect.any(Object)
    );
  });

  it("应该解析 Claude Code 的 JSON 响应", async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockStdout = {
      on: vi.fn((event, cb) => {
        if (event === "data") {
          cb(JSON.stringify({
            result: "Found login button",
            structured_output: {
              elementId: "0-9",
              method: "click",
              arguments: [],
              twoStep: false,
            },
            session_id: "abc-123",
            total_cost_usd: 0.003,
            cost_usd: { "claude-3-5-sonnet": 0.003 },
          }));
        }
      }),
    };

    mockSpawn.mockReturnValue({
      stdout: mockStdout,
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") cb(0);
      }),
    } as any);

    const result = await client.createChatCompletion({
      options: {
        messages: [
          { role: "user", content: "点击登录按钮" },
        ],
      },
      logger: () => {},
    });

    expect(result.choices[0].message.content).toContain("elementId");
    expect(result.choices[0].message.content).toContain("0-9");
    expect(result.choices[0].message.content).toContain("click");
  });

  it("应该处理 Claude Code 执行失败", async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockStderr = {
      on: vi.fn((event, cb) => {
        if (event === "data") {
          cb("Error: claude command not found");
        }
      }),
    };

    mockSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: mockStderr,
      on: vi.fn((event, cb) => {
        if (event === "close") cb(1);
      }),
    } as any);

    await expect(
      client.createChatCompletion({
        options: {
          messages: [{ role: "user", content: "点击登录按钮" }],
        },
        logger: () => {},
      })
    ).rejects.toThrow("claude -p exited with code 1");
  });
});
