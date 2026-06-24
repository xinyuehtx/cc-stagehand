import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class Logger {
  private target: "stdout" | "file";
  private filePath?: string;
  private level: "debug" | "info" | "warn" | "error";

  constructor(options: {
    level?: "debug" | "info" | "warn" | "error";
    target?: "auto" | "stdout" | "file";
    filePath?: string;
  }) {
    this.level = options.level ?? "info";

    // 自动检测日志目标
    if (options.target === "auto" || !options.target) {
      this.target = this.detectTarget();
    } else {
      this.target = options.target;
    }

    if (this.target === "file") {
      this.filePath = options.filePath ?? "./.stagehand-logs/llm-client.log";
      this.ensureLogDirectory();
    }
  }

  private detectTarget(): "stdout" | "file" {
    // 检测 CI 环境
    const isCI = !!(
      process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.JENKINS_URL ||
      process.env.CIRCLECI ||
      process.env.TRAVIS
    );

    return isCI ? "stdout" : "file";
  }

  private ensureLogDirectory() {
    if (!this.filePath) return;

    const dir = dirname(this.filePath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      // 忽略错误，后续写入时会报错
    }
  }

  debug(message: string, data?: Record<string, any>) {
    if (this.level === "debug") {
      this.log("DEBUG", message, data);
    }
  }

  info(message: string, data?: Record<string, any>) {
    if (["debug", "info"].includes(this.level)) {
      this.log("INFO", message, data);
    }
  }

  warn(message: string, data?: Record<string, any>) {
    if (["debug", "info", "warn"].includes(this.level)) {
      this.log("WARN", message, data);
    }
  }

  error(message: string, data?: Record<string, any>) {
    this.log("ERROR", message, data);
  }

  private log(level: string, message: string, data?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}${
      data ? " " + JSON.stringify(data) : ""
    }\n`;

    if (this.target === "stdout") {
      process.stdout.write(logLine);
    } else if (this.target === "file" && this.filePath) {
      appendFileSync(this.filePath, logLine);
    }
  }
}
