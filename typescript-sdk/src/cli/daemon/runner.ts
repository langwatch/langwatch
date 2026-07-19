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
   *
   * What we must NOT do is hand its execution window to somebody else while it
   * is still running — see the note on `abort` in createCommandExecutor.
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

/**
 * How long an ABANDONED command may keep holding its execution window after
 * its caller has already been settled at 124/130.
 *
 * 60s is generous for the thing an abandoned command is actually waiting on —
 * an HTTP request that will fail or time out on its own. Past that we assume it
 * will never settle, and the window can never be handed over safely.
 */
export const DEFAULT_ABANDON_GRACE_MS = 60 * 1000;

/** Operator override: LANGWATCH_DAEMON_REQUEST_TIMEOUT_MS, else the default. */
function resolveRequestTimeoutMs(): number {
  return positiveIntFromEnv(
    process.env.LANGWATCH_DAEMON_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
  );
}

/** Operator override: LANGWATCH_DAEMON_ABANDON_GRACE_MS, else the default. */
function resolveAbandonGraceMs(): number {
  return positiveIntFromEnv(
    process.env.LANGWATCH_DAEMON_ABANDON_GRACE_MS,
    DEFAULT_ABANDON_GRACE_MS,
  );
}

function positiveIntFromEnv(value: string | undefined, fallback: number): number {
  if (value) {
    // A complete positive integer only: parseInt would accept "5000ms" and
    // truncate "1.5", and the documented contract is a millisecond count.
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

/** What the daemon does when an abandoned command never settles. */
export type WedgedHandler = (details: {
  requestId: string;
  graceMs: number;
}) => void;

/**
 * The default: stop being a daemon.
 *
 * There is no third option here. Releasing the window would let the next
 * caller's `applyWindow` chdir and rewrite `process.env` underneath work that
 * is still running. Holding it forever would wedge the daemon into refusing
 * every caller whose window differs, silently, until its idle timeout — which
 * never fires, because the request is still in flight. Exiting is the only
 * outcome that cannot corrupt anybody: the socket goes away, the next
 * invocation finds nothing, and every command runs in-process exactly as it
 * does with no daemon installed.
 */
const exitWhenWedged: WedgedHandler = ({ requestId, graceMs }) => {
  process.stderr.write(
    `langwatch: daemon exiting — abandoned request ${requestId} did not settle ` +
      `within ${Math.round(graceMs / 1000)}s, so its execution window can never be reused safely\n`,
  );
  // EX_SOFTWARE. Not a crash: a deliberate, documented refusal to continue.
  process.exit(70);
};

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
  abandonGraceMs,
  onWedged = exitWhenWedged,
}: {
  window: ExecutionWindow;
  telemetry: DaemonTelemetry;
  /** Injectable for tests; defaults to LANGWATCH_DAEMON_REQUEST_TIMEOUT_MS. */
  requestTimeoutMs?: number;
  /** Injectable for tests; defaults to LANGWATCH_DAEMON_ABANDON_GRACE_MS. */
  abandonGraceMs?: number;
  /** Injectable for tests; defaults to exiting the process. */
  onWedged?: WedgedHandler;
}): CommandExecutor {
  const timeoutMs = requestTimeoutMs ?? resolveRequestTimeoutMs();
  const graceMs = abandonGraceMs ?? resolveAbandonGraceMs();

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
    let abandonTimer: NodeJS.Timeout | undefined;
    const abortController = new AbortController();

    /**
     * Hand the execution window back. Exactly once, and only ever from a point
     * at which the command's own promise chain has actually settled.
     */
    const releaseOnce = (): void => {
      if (abandonTimer) {
        clearTimeout(abandonTimer);
        abandonTimer = undefined;
      }
      const release = releaseWindow;
      releaseWindow = undefined;
      release?.();
    };

    /**
     * The abandoned command still holds the window. Bound how long it may.
     *
     * Nothing here waits on the CALLER — they already have their 124/130. This
     * bounds how long a command that never settles may keep the daemon usable
     * for nobody, and turns "forever" into "the daemon goes away".
     */
    const armAbandonGrace = (): void => {
      // No window is held YET, so there is nothing to bound. Two situations
      // reach here, and NEITHER can wedge — but only because of the
      // post-acquire `cancelled` check below, which is load-bearing:
      //
      //   - Cancelled while still queued. `abortController.abort()` removes the
      //     waiter, acquire rejects, no window is ever taken.
      //   - Cancelled in the gap between admission and the assignment of
      //     `releaseWindow` — i.e. `drain()` already called `resolve()`, so the
      //     abort listener sees an admitted waiter and does nothing. A window
      //     IS held here, and nothing has armed a timer for it. What saves it is
      //     that the continuation re-reads `cancelled` the moment it resumes and
      //     calls `releaseOnce()` without ever starting the work: the window
      //     goes back immediately, which is safe precisely because no command
      //     ever ran under it.
      //
      // Delete that check and this early return becomes the permanent-wedge bug
      // it looks like. `runner.unit.test.ts` drives the interleaving directly.
      if (releaseWindow === undefined || abandonTimer) return;
      abandonTimer = setTimeout(() => {
        abandonTimer = undefined;
        onWedged({ requestId: request.requestId, graceMs });
      }, graceMs);
      abandonTimer.unref();
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
      // The caller is settled NOW — a timeout or a Ctrl-C must never make
      // anybody wait. The WINDOW, though, is deliberately NOT released here.
      //
      // Node cannot unwind the abandoned promise chain, so the command is
      // still running: when it resumes it will resolve relative paths against
      // `process.cwd()` and read credentials out of `process.env` as they are
      // AT THAT MOMENT. Releasing the window admits the next request, whose
      // `applyWindow` (execution.ts) chdirs and rewrites the whole
      // environment — so an abandoned `workflows run --output results.json`
      // would write its file into ANOTHER caller's directory, under another
      // caller's credentials. The window is released by the `finally` below,
      // i.e. when the abandoned work genuinely settles; `armAbandonGrace`
      // bounds the case where it never does.
      settle?.(code);
      armAbandonGrace();
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
        // The ONLY place a window taken by a running command is handed back —
        // including for a command that was abandoned long ago, whose caller is
        // already gone. See the note in `abort`.
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
