/**
 * The top-level runner every one-shot Node script boots through — the seed,
 * the task runner, the codegen scripts haven runs as its own lanes.
 *
 * A script that dies without one prints Node's own multi-line stack, and a
 * supervisor that renders structured lines can only indent it, so a failed
 * lane looks nothing like a failed service. This prints the single structured
 * line every service prints for the same failure: level, message, the error's
 * name, its message, and its `code` when the error carries one — a Node
 * resolution failure's ERR_MODULE_NOT_FOUND is the one worth reading.
 *
 * The line is written synchronously, not through a logger transport: this runs
 * as the process is on its way out, and a worker-thread transport is exactly
 * how a last line gets lost.
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
 * code 1. The stack is left off unless LOG_LEVEL=debug asked for it — it is
 * the part that costs a terminal twenty lines and answers nothing a developer
 * did not already know from the message and the code.
 */
export async function runScript({
  name,
  main,
}: {
  name: string;
  main: () => Promise<unknown> | unknown;
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
 * crashing: level fatal, the event and the error's message as `msg`, and the
 * trace as one `stack` string, so a supervisor renders it as one record with
 * the trace indented under it rather than as a stack frame per line with no
 * level at all. Written by the caller, synchronously, on its way out.
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
  const message = failure?.message ?? (error === void 0 ? void 0 : String(error));
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
