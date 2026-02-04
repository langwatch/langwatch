import pino, { type Logger as PinoLogger } from "pino";

/**
 * Creates a lightweight browser logger.
 * Uses pino's browser mode with console output.
 *
 * @param name - Logger name (e.g., "langwatch:client:component")
 */
export const createLogger = (name: string): PinoLogger => {
  return pino({ name, level: "info", browser: { asObject: true } });
};

export type Logger = PinoLogger;
