/**
 * Universal logger - safe for both browser and server environments.
 *
 * For server-only code with context injection, import from '~/utils/logger/server'.
 */
import pino, { type LoggerOptions, type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

const isTest = process.env.NODE_ENV === "test";
const level = isTest ? "error" : (process.env.PINO_LOG_LEVEL ?? "info");

const baseOptions: LoggerOptions = {
  level,
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: { error: pino.stdSerializers.err },
  formatters: {
    bindings: (bindings) => bindings,
    level: (label) => ({ level: label.toUpperCase() }),
  },
  browser: { asObject: true },
};

export const createLogger = (name: string): PinoLogger => {
  return pino({ ...baseOptions, name });
};
