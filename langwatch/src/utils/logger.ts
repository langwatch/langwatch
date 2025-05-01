import pino, { type Logger, type LoggerOptions } from "pino";

const isBrowser = typeof window !== "undefined";
const isNodeDev = !isBrowser && process.env.NODE_ENV !== "production";

let pinoPretty: any;
if (isNodeDev) {
  try {
    pinoPretty = require("pino-pretty");
  } catch (e) {
    console.error("Failed to load pino-pretty for server-side logging:", e);
  }
}

const getDestinationStream = () => {
  if (isNodeDev && pinoPretty) return pinoPretty({ colorize: true });
  if (!isBrowser) return process.stdout;
  return void 0;
};

export const createLogger = (name: string) => {
  const options: LoggerOptions = {
    name,
    level: isBrowser ? "info" : (process.env.PINO_LOG_LEVEL || "info"),
    timestamp: isBrowser ? undefined : pino.stdTimeFunctions.isoTime,
    browser: { asObject: true },
    formatters: {
      bindings: (bindings) => {
        return bindings; // TODO(afr): Later, add git commit hash, and other stuff for production Node.js
      },
      level: (label) => {
        return { level: label.toUpperCase() };
      },
    },
  };

  const destination = getDestinationStream();

  return (pino as any).default(options, destination as any) as ReturnType<typeof pino>;
};
