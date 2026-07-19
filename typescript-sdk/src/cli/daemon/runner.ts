/**
 * Executes one CLI command inside the daemon and reports its exit code.
 *
 * This is the piece that has to be indistinguishable from a fresh process:
 * same stdout bytes, same stderr bytes, same exit code.
 */

import { buildProgram } from "../program";
import {
  ExecutionContext,
  isDaemonExitSignal,
  withExecutionContext,
  type ExecutionWindow,
  type OutputSink,
} from "./execution";
import type { DaemonTelemetry } from "./telemetry";

export interface ExecuteRequest {
  requestId: string;
  /** User-level args (`process.argv.slice(2)` on the caller). */
  args: string[];
  cwd: string;
  env: Record<string, string>;
  colorLevel: number;
  sink: OutputSink;
}

export interface CommandExecution {
  /** Resolves with the command's exit code once it has finished. */
  completed: Promise<number>;
  /**
   * Abandon the command: stop emitting its output and settle at `code`.
   *
   * The underlying work cannot be killed — it is a promise chain inside this
   * process, and node has no way to unwind one from the outside. What we CAN
   * guarantee is what the caller observes: no further output, an immediate exit
   * code, and a released connection. The abandoned work finishes on its own
   * (it is a single HTTP call) and its output is discarded.
   */
  cancel(code: number): void;
}

export type CommandExecutor = (request: ExecuteRequest) => CommandExecution;

/**
 * 10 minutes: generous for any bounded command (the unbounded ones —
 * `--follow`/`--watch` — never reach the daemon, see eligibility.ts), tight
 * enough that a genuinely hung command cannot pin its execution window (and
 * suppress the daemon's idle exit) for long.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** Operator override: LANGWATCH_DAEMON_REQUEST_TIMEOUT_MS, else the default. */
function resolveRequestTimeoutMs(): number {
  const fromEnv = process.env.LANGWATCH_DAEMON_REQUEST_TIMEOUT_MS;
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * Build the executor the daemon serves requests with.
 *
 * Injected into the server so tests can drive the socket, handshake, framing
 * and lifecycle without commander in the picture.
 */
export function createCommandExecutor({
  window,
  telemetry,
  requestTimeoutMs,
}: {
  window: ExecutionWindow;
  telemetry: DaemonTelemetry;
  /** Injectable for tests; defaults to LANGWATCH_DAEMON_REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number;
}): CommandExecutor {
  const timeoutMs = requestTimeoutMs ?? resolveRequestTimeoutMs();

  return (request: ExecuteRequest): CommandExecution => {
    const context = new ExecutionContext(request.requestId, (stream, chunk) => {
      request.sink(stream, chunk);
      telemetry.requestProgress({
        requestId: request.requestId,
        stream,
        bytes: chunk.byteLength,
      });
    });

    let cancelled = false;
    let settle: ((code: number) => void) | undefined;
    let releaseWindow: (() => void) | undefined;
    const abortController = new AbortController();

    // Releasing the window is deliberately decoupled from the command's own
    // completion. The command's promise chain cannot be killed from the
    // outside, so a command that hangs forever would otherwise hold its
    // working-directory window forever too — blocking every caller whose
    // (cwd, env, colour) tuple differs, and suppressing the daemon's idle
    // exit. On cancel/timeout the window is freed immediately; the abandoned
    // work finishes (or doesn't) on its own and its `finally` release is a
    // no-op.
    const releaseOnce = (): void => {
      const release = releaseWindow;
      releaseWindow = undefined;
      release?.();
    };

    const abort = (code: number, note?: string): void => {
      if (context.isFinished) return;
      cancelled = true;
      if (note !== undefined) {
        context.write("stderr", Buffer.from(note, "utf8"));
      }
      // Finalising first is what actually enforces the cancellation: every
      // subsequent write from the abandoned command is dropped on the floor.
      context.finalize(code);
      // Wakes a request still QUEUED for its window; a no-op otherwise.
      abortController.abort();
      releaseOnce();
      settle?.(code);
    };

    // 124, the `timeout(1)` convention, so scripts can tell a timeout apart
    // from both a command failure (1) and a client cancel (130).
    const timeout = setTimeout(() => {
      abort(
        124,
        `langwatch: request timed out after ${Math.round(timeoutMs / 1000)}s; the daemon abandoned it\n`,
      );
    }, timeoutMs);
    timeout.unref();

    const completed = (async (): Promise<number> => {
      const startedAt = Date.now();

      // May reject when the caller's cwd no longer exists. The server turns
      // that into a `fallback` frame — no output has been emitted yet, so the
      // client can safely re-run the command itself.
      let release: (() => void) | undefined;
      try {
        release = await window.acquire(
          {
            cwd: request.cwd,
            env: request.env,
            colorLevel: request.colorLevel,
          },
          abortController.signal,
        );
      } catch (error) {
        // Aborted while queued: the cancel/timeout path already settled the
        // caller; there is nothing left to report.
        if (cancelled) return context.exitCode;
        throw error;
      }
      releaseWindow = release;

      // Admitted at the same moment the abort fired. Don't start the work.
      if (cancelled) {
        releaseOnce();
        return context.exitCode;
      }

      telemetry.requestStarted({
        requestId: request.requestId,
        args: request.args,
        cwd: request.cwd,
      });

      let failure: unknown;
      try {
        // A fresh tree per request: commander mutates its Command objects with
        // the parsed option values, so a shared tree would leak options between
        // callers.
        const program = buildProgram();
        await withExecutionContext(context, () =>
          program.parseAsync(request.args, { from: "user" }),
        );
        context.finalize(0);
      } catch (error) {
        if (isDaemonExitSignal(error)) {
          // The command (or commander itself) called process.exit. The context
          // was finalised at the moment of the call, so its code already wins
          // and anything the unwinding stack printed was discarded.
          context.finalize(error.code);
        } else {
          failure = error;
          // An action that rejected without handling it. In a real process this
          // is an unhandled rejection: node prints the error and exits 1. We
          // print the same error and exit 1. (Node also prints its own internal
          // frames and a version banner; those we do not reproduce.)
          const stack =
            error instanceof Error
              ? (error.stack ?? `${error.name}: ${error.message}`)
              : String(error);
          context.write("stderr", Buffer.from(stack + "\n", "utf8"));
          context.finalize(1);
        }
      } finally {
        releaseOnce();
      }

      telemetry.requestFinished({
        requestId: request.requestId,
        exitCode: context.exitCode,
        durationMs: Date.now() - startedAt,
        error: failure,
        cancelled,
      });

      return context.exitCode;
    })();

    // The promise the server awaits: whichever of "the command finished" or
    // "the client cancelled" happens first.
    const raced = new Promise<number>((resolve, reject) => {
      const finish = (code: number): void => {
        clearTimeout(timeout);
        resolve(code);
      };
      settle = finish;
      completed.then(finish, (error: unknown) => {
        clearTimeout(timeout);
        // A rejection means the window could not be applied (e.g. the caller's
        // cwd was deleted) BEFORE any output was produced — the server turns
        // it into a `fallback` frame so the client re-runs in-process. It must
        // NOT be swallowed into a fake exit code: an empty `exit 0` is the
        // "silent, looks like it worked" failure the daemon is designed
        // against. Cancel/timeout never land here: those settle via `finish`,
        // and an aborted-while-queued acquire RESOLVES `completed` (see the
        // cancelled check above) rather than rejecting it.
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    return {
      completed: raced,
      cancel: (code: number) => abort(code),
    };
  };
}
