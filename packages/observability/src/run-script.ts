/**
 * The top-level runner every one-shot Node script boots through: prints one
 * structured error line synchronously if the script fails.
 */

/** The shape of one written record, matching the shared dev log format. */
type ScriptFailureRecord = {
  level: "error";
  time: string;
  service: string;
  msg: string;
  error: { type: string; message: string; code?: string; stack?: string };
};

/**
 * Runs `main`, and turns any failure into one structured line plus exit
 * code 1. The stack is left off unless LOG_LEVEL=debug asked for it — it
 * costs a terminal twenty lines and tells a developer nothing new.
 */
export async function runScript({
  name,
  main,
}: {
  name: string;
  main: () => unknown;
}): Promise<void> {
  try {
    await main();
  } catch (error: unknown) {
    process.stdout.write(
      `${JSON.stringify(scriptFailureRecord({ name, error, withStack: wantsStack() }))}\n`,
    );
    process.exitCode = 1;
  }
}

/**
 * One structured warn line from a one-shot script, in the same shape as the
 * failure line above — for the thing a script decided to carry on without.
 */
export function writeScriptWarning({
  name,
  msg,
  fields,
}: {
  name: string;
  msg: string;
  fields?: Readonly<Record<string, unknown>>;
}): void {
  process.stdout.write(
    `${JSON.stringify({
      level: "warn",
      time: new Date().toISOString(),
      service: name,
      msg,
      ...fields,
    })}\n`,
  );
}

/** Whether the process asked for stacks. Only `debug` and `trace` do. */
function wantsStack(): boolean {
  const level = (process.env.LOG_LEVEL ?? "").trim().toLowerCase();
  return level === "debug" || level === "trace";
}

/**
 * One failure as the record a service would have written. Exported for the
 * test that pins the shape; the runner is the only production caller.
 */
export function scriptFailureRecord({
  name,
  error,
  withStack,
}: {
  name: string;
  error: unknown;
  withStack: boolean;
}): ScriptFailureRecord {
  const failure = error instanceof Error ? error : void 0;
  const code = failure === void 0 ? void 0 : (failure as { code?: unknown }).code;

  return {
    level: "error",
    time: new Date().toISOString(),
    service: name,
    msg: `${name} failed`,
    error: {
      type: failure?.name ?? typeof error,
      message: failure?.message ?? String(error),
      ...(typeof code === "string" ? { code } : {}),
      ...(withStack && typeof failure?.stack === "string" ? { stack: failure.stack } : {}),
    },
  };
}

/**
 * The one line a long-running process writes when it cannot boot or is
 * crashing: fatal level, the error's message as `msg`, trace as one `stack`
 * string — one record a supervisor renders indented, not a level-less frame per line.
 */
export function processFailureLine({
  service,
  event,
  error,
}: {
  service: string;
  event: string;
  error?: unknown;
}): string {
  const failure = error instanceof Error ? error : void 0;
  const code = failure === void 0 ? void 0 : (failure as { code?: unknown }).code;
  const message =
    failure?.message ??
    (typeof error === "string" || error === void 0 ? error : JSON.stringify(error));
  return `${JSON.stringify({
    level: "fatal",
    time: new Date().toISOString(),
    service,
    msg: message === void 0 ? event : `${event}: ${message}`,
    ...(error === void 0
      ? {}
      : {
          error: {
            type: failure?.name ?? typeof error,
            message: message ?? "",
            ...(typeof code === "string" ? { code } : {}),
          },
        }),
    ...(typeof failure?.stack === "string" ? { stack: failure.stack } : {}),
  })}\n`;
}
