import pino from "pino";
import pinoPretty from "pino-pretty";
import { type Debugger } from "debug";

export const getDebugger = (namespace: string): Debugger => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-var-requires
  return require("debug")(namespace) as Debugger;
};

export const createLogger = (name: string) => {
  const prettyStream = pinoPretty({ colorize: true });
  return pino(
    {
      name,
      level: process.env.PINO_LOG_LEVEL || "info",
    },
    process.env.NODE_ENV === "development" ? prettyStream : process.stdout
  );
};
