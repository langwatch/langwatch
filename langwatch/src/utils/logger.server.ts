import pino from "pino";
import pinoPretty from "pino-pretty";

export const createLogger = (name: string) => {
  const prettyStream = pinoPretty({ colorize: true });

  return (pino as any).default(
    {
      name,
      level: process.env.PINO_LOG_LEVEL || "info",
    },
    process.env.NODE_ENV === "development" ? prettyStream : process.stdout
  );
};
