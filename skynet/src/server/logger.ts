/**
 * Lightweight structured logger for Skynet.
 *
 * Wraps console methods with JSON-structured context objects so that
 * log output is machine-parseable while keeping the dependency footprint
 * at zero (no pino/winston).
 */

function safeStringify(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj);
  } catch (err) {
    return JSON.stringify({
      level: obj.level,
      module: obj.module,
      msg: obj.msg,
      contextError: `unserializable_context: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

export function createLogger(module: string) {
  return {
    info({ context, message }: { context: Record<string, unknown>; message: string }) {
      console.log(safeStringify({ ...context, level: "info", module, msg: message }));
    },
    warn({ context, message }: { context: Record<string, unknown>; message: string }) {
      console.warn(safeStringify({ ...context, level: "warn", module, msg: message }));
    },
    error({ context, message }: { context: Record<string, unknown>; message: string }) {
      console.error(safeStringify({ ...context, level: "error", module, msg: message }));
    },
  };
}
