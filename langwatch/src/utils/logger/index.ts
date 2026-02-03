/**
 * Universal logger - safe for both browser and server environments.
 *
 * For server-only code with context injection, import from '~/utils/logger/server'.
 */
import pino, { type Logger as PinoLogger } from "pino";

export type Logger = PinoLogger;

export const createLogger = (name: string): PinoLogger =>
  pino({ name, level: "info", browser: { asObject: true } });
