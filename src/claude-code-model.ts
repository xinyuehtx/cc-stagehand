import { spawn } from "node:child_process";
import type { Logger } from "./logger.js";
import type { ClaudeCodeResponse } from "./types.js";

export class ClaudeCodeLanguageModel {
  constructor(
    private options: {
      systemPromptEnhancement?: string;
      claudeArgs?: string[];
      timeout?: number;
      verbose?: boolean;
      logger: Logger;
    }
  ) {}

  async generate(
    systemPrompt: string | undefined,
    userPrompt: string
  ): Promise<ClaudeCodeResponse> {
    const startTime = Date.now();

    // 1. 构建 claude -p 命令
    const commandArgs = this.buildCommandArgs(systemPrompt, userPrompt);

    this.options.logger.debug("Claude Code 命令", {
      command: `claude ${commandArgs.join(" ")}`,
    });

    // 2. 执行 claude -p
    const claudeResponse = await this.executeClaudeCommand(commandArgs);

    const durationMs = Date.now() - startTime;

    this.options.logger.info("Claude Code 调用完成", {
      durationMs,
      costUsd: claudeResponse.total_cost_usd,
      sessionId: claudeResponse.session_id,
    });

    return claudeResponse;
  }

  buildCommandArgs(
    systemPrompt: string | undefined,
    userPrompt: string
  ): string[] {
    const args = ["-p", userPrompt];

    // 追加 system prompt（Stagehand 的 + 增强）
    if (systemPrompt || this.options.systemPromptEnhancement) {
      const fullSystemPrompt = [
        systemPrompt ?? "",
        this.options.systemPromptEnhancement ?? "",
      ]
        .filter(Boolean)
        .join("\n\n");

      args.push("--append-system-prompt", fullSystemPrompt);
    }

    // 输出格式
    args.push("--output-format", "json");

    // 单次推理（不需要 agent loop）
    args.push("--max-turns", "1");

    // 额外参数（如 --project-dir）
    if (this.options.claudeArgs) {
      args.push(...this.options.claudeArgs);
    }

    return args;
  }

  private async executeClaudeCommand(
    args: string[]
  ): Promise<ClaudeCodeResponse> {
    return new Promise((resolve, reject) => {
      const proc = spawn("claude", args, {
        timeout: this.options.timeout,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          this.options.logger.error("Claude Code 执行失败", {
            exitCode: code,
            stderr: stderr.substring(0, 500),
          });
          reject(new Error(`claude -p exited with code ${code}: ${stderr}`));
          return;
        }

        try {
          const response = JSON.parse(stdout) as ClaudeCodeResponse;
          resolve(response);
        } catch (error) {
          this.options.logger.error("Claude Code 响应解析失败", {
            stdout: stdout.substring(0, 500),
            error: String(error),
          });
          reject(new Error(`Failed to parse Claude Code response: ${error}`));
        }
      });

      proc.on("error", (error) => {
        this.options.logger.error("Claude Code 启动失败", {
          error: String(error),
        });
        reject(new Error(`Failed to spawn claude process: ${error}`));
      });
    });
  }
}
