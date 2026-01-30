import type { Logger as PinoLogger } from "pino";

export interface CreateLoggerOptions {
  /**
   * Disable automatic context injection (traceId, spanId, organizationId, projectId, userId).
   * Server-only option - ignored in browser.
   */
  disableContext?: boolean;
}

/**
 * Creates a logger instance with the given name.
 * Automatically detects browser vs server environment.
 *
 * - Browser: Lightweight pino logger with console output
 * - Server: Full pino with transports, context injection, and optional OTel export
 *
 * @param name - Logger name (e.g., "langwatch:api:hono")
 * @param options - Optional configuration (server-only options ignored in browser)
 */
export const createLogger = (
  name: string,
  options?: CreateLoggerOptions,
): PinoLogger => {
  if (typeof window !== "undefined") {
    // Browser: use lightweight client logger
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLogger: createClientLogger } = require("./logger.client") as {
      createLogger: (name: string) => PinoLogger;
    };
    return createClientLogger(name);
  }

  // Server: use the full server logger with transports
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createLogger: createServerLogger } = require("./logger.server") as {
    createLogger: (name: string, options?: CreateLoggerOptions) => PinoLogger;
  };
  return createServerLogger(name, options);
};

export type Logger = PinoLogger;
