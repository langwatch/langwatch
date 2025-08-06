// Logger utility for SDKs
//
// Usage:
//   - If you pass your own Logger implementation, the SDK will use it as-is (no log level filtering or prefixing applied).
//   - If you use ConsoleLogger, you can specify log level and prefix options.
//   - NoOpLogger disables all logging.
//
// Example:
//   const logger = new ConsoleLogger({ level: "warn", prefix: "SDK" });
//   logger.info("This will not show");
//   logger.warn("This will show with prefix");
//
//   // If you pass your own logger, SDK will not filter logs:
//   const customLogger: Logger = { ... };
//   // SDK uses customLogger as-is

export type LogLevel = "debug" | "info" | "warn" | "error";

const logLevelOrder: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export class NoOpLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

interface ConsoleLoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

/**
 * ConsoleLogger applies log level filtering and optional prefixing.
 * If you pass your own Logger, the SDK will not apply log level filtering or prefixing.
 */
export class ConsoleLogger implements Logger {
  private level: LogLevel;
  private prefix?: string;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.prefix = options.prefix;
  }

  private shouldLog(level: LogLevel): boolean {
    return logLevelOrder[level] >= logLevelOrder[this.level];
  }

  private format(message: string): string {
    return this.prefix ? `[${this.prefix}] ${message}` : message;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog("debug")) console.debug(this.format(message), ...args);
  }
  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog("info")) console.info(this.format(message), ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog("warn")) console.warn(this.format(message), ...args);
  }
  error(message: string, ...args: unknown[]): void {
    if (this.shouldLog("error")) console.error(this.format(message), ...args);
  }
}
