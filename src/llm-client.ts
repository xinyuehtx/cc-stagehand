import { LLMClient, toJsonSchema } from "@browserbasehq/stagehand";
import type {
  CreateChatCompletionOptions,
  LLMResponse,
  LLMParsedResponse,
  LLMUsage,
} from "@browserbasehq/stagehand";
import { ClaudeCodeLanguageModel } from "./claude-code-model.js";
import { Logger } from "./logger.js";
import type { ClaudeCodeLLMClientOptions, ClaudeCodeResponse } from "./types.js";

export function createClaudeCodeLLMClient(
  options: ClaudeCodeLLMClientOptions = {}
): LLMClient {
  return new ClaudeCodeLLMClient(options);
}

class ClaudeCodeLLMClient extends LLMClient {
  type = "claude-code" as const;
  hasVision = false;

  private model: ClaudeCodeLanguageModel;
  private logger: Logger;

  constructor(options: ClaudeCodeLLMClientOptions) {
    super("claude-code", options.systemPromptEnhancement);

    this.logger = new Logger({
      level: options.logLevel ?? "info",
      target: options.logTarget ?? "auto",
      filePath: options.logFilePath,
    });

    this.model = new ClaudeCodeLanguageModel({
      systemPromptEnhancement: options.systemPromptEnhancement,
      claudeArgs: options.claudeArgs,
      cwd: options.cwd,
      timeout: options.timeout ?? 60000,
      verbose: options.verbose ?? false,
      logger: this.logger,
    });

    this.modelName = "claude-code";
    this.clientOptions = {};
  }

  async createChatCompletion<T = LLMResponse>(
    createOptions: CreateChatCompletionOptions
  ): Promise<T | LLMParsedResponse<T>> {
    const { options } = createOptions;
    const messages = options.messages;

    if (!messages || messages.length === 0) {
      throw new Error("ClaudeCodeLLMClient: no messages provided");
    }

    this.logger.debug("createChatCompletion 被调用", {
      messageCount: messages.length,
      hasResponseModel: !!options.response_model,
    });

    // 提取 system / user prompt
    const systemMessage = messages.find((m) => m.role === "system");
    const userMessage = messages.find((m) => m.role === "user");

    if (!userMessage) {
      throw new Error("ClaudeCodeLLMClient: no user message found");
    }

    let systemPrompt = systemMessage
      ? this.extractText(systemMessage.content)
      : undefined;
    const userPrompt = this.extractText(userMessage.content);

    // 提取 JSON Schema（如果有 response_model）
    let jsonSchema: object | undefined;
    const schemaName = options.response_model?.name;
    if (options.response_model) {
      const schema = toJsonSchema(options.response_model.schema);
      jsonSchema = schema;
      this.logger.debug("提取 JSON Schema", {
        schemaName: options.response_model.name,
        schemaType: schema.type,
      });
    }

    // 调用 Claude Code，传递 JSON Schema
    const result = await this.model.generate(systemPrompt, userPrompt, jsonSchema);

    // 根据是否有 response_model 返回不同格式
    if (options.response_model) {
      return this.toExtractResponse<T>(result, schemaName);
    }

    return this.toActResponse(result) as unknown as T | LLMParsedResponse<T>;
  }

  /**
   * extract 场景：返回 { data, usage }
   */
  private toExtractResponse<T>(
    result: ClaudeCodeResponse,
    schemaName?: string
  ): LLMParsedResponse<T> {
    const usage: LLMUsage = {
      prompt_tokens: Math.ceil((result.result?.length ?? 0) / 4),
      completion_tokens: Math.ceil((result.result?.length ?? 0) / 4),
      total_tokens: Math.ceil((result.result?.length ?? 0) / 2),
    };

    // 对于 act schema，不需要转换 ID（elementId 需要保持为字符串）
    const shouldFixIds = schemaName !== "act";

    // Claude Code 的 structured_output 已经是结构化 JSON
    if (result.structured_output) {
      const data = shouldFixIds
        ? this.fixNumericIds(result.structured_output)
        : result.structured_output;
      return { data: data as T, usage };
    }

    // 否则尝试从文本中解析 JSON
    const text = result.result ?? "";

    // 先尝试移除 markdown 代码块标记
    const cleanedText = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        this.logger.debug("成功解析 JSON 对象", { keys: Object.keys(parsed) });
        const data = shouldFixIds ? this.fixNumericIds(parsed) : parsed;
        return { data: data as T, usage };
      } catch (parseError) {
        this.logger.warn("无法从 Claude Code 响应中解析 JSON 对象", {
          preview: jsonMatch[0].substring(0, 300),
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    }

    // 数组格式的 JSON
    const arrayMatch = cleanedText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        this.logger.debug("成功解析 JSON 数组", { length: parsed.length });
        const data = shouldFixIds ? this.fixNumericIds(parsed) : parsed;
        return { data: data as T, usage };
      } catch (parseError) {
        this.logger.warn("无法从 Claude Code 响应中解析 JSON 数组", {
          preview: arrayMatch[0].substring(0, 300),
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    }

    throw new Error(
      `ClaudeCodeLLMClient: failed to parse extract response: ${text.substring(0, 200)}`
    );
  }

  /**
   * act 场景：返回标准 LLMResponse 格式
   * 注意：Stagehand 的 act() 实际上会传递 response_model，所以会走 toExtractResponse 路径
   * 这个方法主要用于单元测试和向后兼容
   */
  private toActResponse(
    result: ClaudeCodeResponse
  ): LLMResponse {
    // 优先使用 structured_output，否则使用 result
    const content = result.structured_output
      ? JSON.stringify(result.structured_output)
      : result.result ?? "";

    return {
      id: `cmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "claude-code",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content,
            tool_calls: [],
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: Math.ceil((content?.length ?? 0) / 4),
        completion_tokens: Math.ceil((content?.length ?? 0) / 4),
        total_tokens: Math.ceil((content?.length ?? 0) / 2),
      },
    };
  }

  /**
   * 从 Claude Code 响应中提取文本内容
   */
  private extractText(content: any): string {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((c) => c.type === "text")
        .map((c) => c.text || "")
        .join("\n");
    }
    return "";
  }

  /**
   * 将 Claude Code 返回的字符串 URL ID 转换为数字
   * Stagehand 内部将 z.string().url() 转换为 z.number()，期望 LLM 返回数字 ID
   * Claude Code 可能返回字符串格式的 ID（如 "0-6534"），需要转换为数字
   */
  private fixNumericIds(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "string") {
      // 检查是否是 "数字-数字" 格式的 URL ID
      const match = obj.match(/^(\d+)-(\d+)$/);
      if (match) {
        // 返回第二个数字作为 ID
        const id = parseInt(match[2], 10);
        this.logger.debug(`URL ID 转换: "${obj}" -> ${id}`);
        return id;
      }
      // 检查是否是纯数字字符串
      if (/^\d+$/.test(obj)) {
        return parseInt(obj, 10);
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.fixNumericIds(item));
    }

    if (typeof obj === "object") {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.fixNumericIds(value);
      }
      return result;
    }

    return obj;
  }
}
