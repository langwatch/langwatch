/**
 * Lightweight structured logger for Skynet.
 *
 * Wraps console methods with JSON-structured context objects so that
 * log output is machine-parseable while keeping the dependency footprint
 * at zero (no pino/winston).
 */
export function createLogger(module: string) {
  return {
    info(context: Record<string, unknown>, message: string) {
      console.log(JSON.stringify({ level: "info", module, msg: message, ...context }));
    },
    warn(context: Record<string, unknown>, message: string) {
      console.warn(JSON.stringify({ level: "warn", module, msg: message, ...context }));
    },
    error(context: Record<string, unknown>, message: string) {
      console.error(JSON.stringify({ level: "error", module, msg: message, ...context }));
    },
  };
}
