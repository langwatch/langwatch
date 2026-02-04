/**
 * Universal logger - safe for both browser and server environments.
 *
 * For server-only code with context injection, import from '~/utils/logger/server'.
 */
import pino, { type LoggerOptions, type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

const isTest = process.env.NODE_ENV === "test";
const isDevMode = process.env.NODE_ENV !== "production";
const level = isTest ? "error" : (process.env.PINO_LOG_LEVEL ?? "info");

export const createLogger = (name: string): PinoLogger => {
  const options: LoggerOptions = {
    name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { error: pino.stdSerializers.err },
    formatters: {
      bindings: (bindings) => bindings,
      level: (label) => ({ level: label.toUpperCase() }),
    },
    browser: { asObject: true },
  };

  // In test mode or browser, use basic pino
  if (isTest || typeof window !== "undefined") {
    return pino(options);
  }

  // In dev mode, use pino-pretty
  if (isDevMode) {
    try {
      const transport = pino.transport({
        target: "pino-pretty",
        options: { colorize: true },
      });
      return pino(options, transport);
    } catch {
      // Fallback if pino-pretty not available
      return pino(options);
    }
  }

  // Production: JSON to stdout
  return pino(options);
};
