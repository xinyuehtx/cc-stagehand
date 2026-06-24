import type {
  LLMClient,
  ChatCompletionOptions,
  ChatMessage,
  ChatMessageContent,
  LLMResponse,
  ClaudeCodeLLMClientOptions,
  ClaudeCodeResponse,
} from "./types.js";
import { ClaudeCodeLanguageModel } from "./claude-code-model.js";
import { Logger } from "./logger.js";

export function createClaudeCodeLLMClient(
  options: ClaudeCodeLLMClientOptions = {}
): LLMClient {
  return new ClaudeCodeLLMClient(options);
}

class ClaudeCodeLLMClient implements LLMClient {
  private model: ClaudeCodeLanguageModel;
  private logger: Logger;

  constructor(options: ClaudeCodeLLMClientOptions) {
    this.logger = new Logger({
      level: options.logLevel ?? "info",
      target: options.logTarget ?? "auto",
      filePath: options.logFilePath,
    });

    this.model = new ClaudeCodeLanguageModel({
      systemPromptEnhancement: options.systemPromptEnhancement,
      claudeArgs: options.claudeArgs,
      timeout: options.timeout ?? 30000,
      verbose: options.verbose ?? false,
      logger: this.logger,
    });
  }

  async createChatCompletion(options: ChatCompletionOptions): Promise<LLMResponse> {
    this.logger.debug("LLMClient.createChatCompletion 被调用", {
      messageCount: options.messages.length,
    });

    // 1. 提取 Stagehand 传入的 messages（不修改）
    const { systemPrompt, userPrompt } = this.extractPrompts(options.messages);

    // 2. 调用 Claude Code
    const result = await this.model.generate(systemPrompt, userPrompt);

    // 3. 转换为 Stagehand 期望的 LLMResponse 格式
    return this.convertToStagehandResponse(result);
  }

  private extractPrompts(messages: ChatMessage[]): {
    systemPrompt: string | undefined;
    userPrompt: string;
  } {
    // Stagehand 的消息格式：[system, user] 或 [user]
    const systemMessage = messages.find(m => m.role === "system");
    const userMessage = messages.find(m => m.role === "user");

    if (!userMessage) {
      throw new Error("No user message found in Stagehand messages");
    }

    // 提取 system prompt（如果有）
    const systemPrompt = systemMessage
      ? this.extractTextFromContent(systemMessage.content)
      : undefined;

    // 提取 user prompt（AX 树 + 指令）
    const userPrompt = this.extractTextFromContent(userMessage.content);

    return { systemPrompt, userPrompt };
  }

  private extractTextFromContent(content: ChatMessageContent): string {
    if (typeof content === "string") {
      return content;
    }

    // 处理多部分消息（文本 + 图片）
    const textParts = content.filter(p => p.type === "text");
    return textParts.map(p => p.text ?? "").join("\n");
  }

  private convertToStagehandResponse(
    result: ClaudeCodeResponse
  ): LLMResponse {
    // Claude Code 的 structured_output 已经是正确的格式
    const outputText = result.structured_output
      ? JSON.stringify(result.structured_output)
      : result.result;

    return {
      id: `claude-code-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "claude-code",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputText,
            tool_calls: [],
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(outputText.length / 4),
        completion_tokens: Math.ceil(outputText.length / 4),
        total_tokens: Math.ceil(outputText.length / 2),
      },
    };
  }
}
