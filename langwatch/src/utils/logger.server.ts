import pino, { type LoggerOptions } from "pino";
import pinoPretty from "pino-pretty";

export const createLogger = (name: string) => {
  const prettyStream = pinoPretty({ colorize: true });
  const options: LoggerOptions = {
    name,
    level: process.env.PINO_LOG_LEVEL || "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      bindings: (bindings) => {
        if (process.env.NODE_ENV === "development") {
          return bindings;
        }

        return bindings; // TODO(afr): Later, add git commit hash, and other stuff
      },
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    }
  };

  return (pino as any).default(
    options,
    process.env.NODE_ENV === "development" ? prettyStream : process.stdout
  ) as ReturnType<typeof pino>;
};
