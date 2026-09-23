/**
 * Executes one CLI command inside the daemon and reports its exit code —
 * indistinguishable from a fresh process: same stdout bytes, same stderr
 * bytes, same exit code.
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
  /**
   * The bin the CALLER typed (`process.argv[1]` on the client). One daemon
   * serves both `lw` and `langwatch`, so the program has to be named from this
   * rather than from the daemon's own argv. See `ExecFrame.bin`.
   */
  bin?: string;
  sink: OutputSink;
}

export interface CommandExecution {
  /** Resolves with the command's exit code once it has finished. */
  completed: Promise<number>;
  /**
   * Abandon the command: stop emitting output and settle at `code`. The work
   * can't be killed, so this only guarantees observable behavior while it
   * finishes silently; its execution window can't be handed off until then (see `abort`).
   */
  cancel(code: number): void;
}

export type CommandExecutor = (request: ExecuteRequest) => CommandExecution;

/**
 * 10 minutes: generous for any bounded command (unbounded ones like
 * `--follow`/`--watch` never reach the daemon, see eligibility.ts), yet
 * tight enough a hung command can't pin the window and block idle exit.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * How long an ABANDONED command may hold its execution window after its
 * caller is settled at 124/130. 60s is generous for what it's waiting on (an
 * HTTP request that fails or times out); past that the window can't be handed over safely.
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
export type WedgedHandler = (details: { requestId: string; graceMs: number }) => void;

/**
 * The default: stop being a daemon. Holding the window forever wedges every
 * other caller until an idle timeout that never fires; exiting is the only
 * option that can't corrupt the next caller's `applyWindow` chdir/env rewrite.
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
 * Build the executor the daemon serves requests with — injected into the
 * server so tests can drive the socket, handshake, framing and lifecycle
 * without commander in the picture.
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
     * The abandoned command still holds the window; this bounds how long. Nothing
     * here waits on the CALLER — they already have their 124/130 — it only stops
     * a command that never settles from keeping the daemon usable for nobody, forever.
     */
    const armAbandonGrace = (): void => {
      // Safe only because the post-acquire `cancelled` check re-reads before
      // starting work, releasing any window taken in the gap between admission
      // and cancellation; delete it and this early return becomes a permanent
      // wedge (see runner.unit.test.ts).
      if (releaseWindow === undefined || abandonTimer) return;
      abandonTimer = setTimeout(() => {
        abandonTimer = undefined;
        onWedged({ requestId: request.requestId, graceMs });
      }, graceMs);
      abandonTimer.unref();
    };

    const abort = ({ code, note }: { code: number; note?: string }): void => {
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
      // The caller settles now, but the WINDOW stays held: node can't unwind
      // the abandoned promise chain, so it's still running and will later read
      // `process.cwd()`/`process.env` — releasing early would let the next
      // caller's `applyWindow` rewrite those out from under it. `finally`
      // releases it once work truly settles; `armAbandonGrace` bounds the rest.
      settle?.(code);
      armAbandonGrace();
    };

    // 124, the `timeout(1)` convention, so scripts can tell a timeout apart
    // from both a command failure (1) and a client cancel (130).
    const timeout = setTimeout(() => {
      abort({
        code: 124,
        note: `langwatch: request timed out after ${Math.round(timeoutMs / 1000)}s; the daemon abandoned it\n`,
      });
    }, timeoutMs);
    timeout.unref();

    const completed = (async (): Promise<number> => {
      const startedAt = Date.now();

      // May reject when the caller's cwd no longer exists. The server turns
      // that into a `fallback` frame — no output has been emitted yet, so the
      // client can safely re-run the command itself.
      let release: (() => void) | undefined;
      try {
        release = await window.acquire({
          request: {
            cwd: request.cwd,
            env: request.env,
            colorLevel: request.colorLevel,
          },
          signal: abortController.signal,
        });
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
        // callers. Named from the CALLER's bin, not this process's — see
        // `ExecuteRequest.bin`.
        const program = buildProgram({ bin: request.bin });
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
      completed.then(finish).catch((error: unknown) => {
        clearTimeout(timeout);
        // A rejection means the window couldn't be applied before any output was
        // produced — the server turns it into a `fallback` frame for the client to
        // re-run, rather than a fake exit code (which would look like success).
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    return {
      completed: raced,
      cancel: (code: number) => abort({ code }),
    };
  };
}
