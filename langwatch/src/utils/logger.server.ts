import pino, { type LoggerOptions } from "pino";
import pinoPretty from "pino-pretty";

export const createLogger = (name: string) => {
  const prettyStream = pinoPretty({ colorize: true });
  const options: LoggerOptions = {
    name,
    level: process.env.PINO_LOG_LEVEL || "info",
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return (pino as any).default(
    options,
    process.env.NODE_ENV === "development" ? prettyStream : process.stdout
  ) as ReturnType<typeof pino>;
};
