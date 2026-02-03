/**
 * Universal logger - safe for both browser and server environments.
 *
 * For server-only code with context injection, import from '~/utils/logger/server'.
 */
import pino, { type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

const level =
  process.env.NODE_ENV === "test"
    ? "error"
    : process.env.PINO_LOG_LEVEL ?? "info";

export const createLogger = (name: string): PinoLogger =>
  pino({ name, level, browser: { asObject: true } });
