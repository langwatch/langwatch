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

export class ConsoleLogger implements Logger {
  debug(message: string, ...args: unknown[]): void {
    console.debug(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    console.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    console.error(message, ...args);
  }
}

export class PrefixedLogger implements Logger {
  constructor(private logger: Logger, private prefix: string) {}

  private formatMessage(message: string): string {
    return `[${this.prefix}] ${message}`;
  }

  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(this.formatMessage(message), ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.logger.info(this.formatMessage(message), ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.logger.warn(this.formatMessage(message), ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.logger.error(this.formatMessage(message), ...args);
  }
}
