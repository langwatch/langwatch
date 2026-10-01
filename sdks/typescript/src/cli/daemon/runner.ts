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

  return (request: ExecuteRequest): CommandExecution =>
    new RequestExecution({ request, window, telemetry, timeoutMs, graceMs, onWedged }).start();
}

/** Node's own report for a rejection nobody handled: the stack, else name and message. */
const unhandledReport = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);

/**
 * Runs the request's command in its context and answers the failure it threw,
 * if any. A process.exit call already finalised the context, so its code wins.
 */
async function runProgram({
  request,
  context,
}: {
  request: ExecuteRequest;
  context: ExecutionContext;
}): Promise<unknown> {
  try {
    // A fresh tree per request: commander mutates its Command objects with
    // the parsed option values, so a shared tree would leak options between
    // callers. Named from the CALLER's bin, not this process's — see
    // `ExecuteRequest.bin`.
    const program = buildProgram({ bin: request.bin });
    await withExecutionContext(context, () => program.parseAsync(request.args, { from: "user" }));
    context.finalize(0);
    return undefined;
  } catch (error) {
    if (isDaemonExitSignal(error)) {
      context.finalize(error.code);
      return undefined;
    }
    // An action that rejected without handling it. In a real process this
    // is an unhandled rejection: node prints the error and exits 1, and so do we.
    context.write("stderr", Buffer.from(unhandledReport(error) + "\n", "utf8"));
    context.finalize(1);
    return error;
  }
}

/** One request's run: its window, its cancellation and its abandon grace. */
class RequestExecution {
  private cancelled = false;
  private settle: ((code: number) => void) | undefined;
  private releaseWindow: (() => void) | undefined;
  private abandonTimer: NodeJS.Timeout | undefined;
  private readonly abortController = new AbortController();
  private readonly context: ExecutionContext;
  private readonly request: ExecuteRequest;
  private readonly window: ExecutionWindow;
  private readonly telemetry: DaemonTelemetry;
  private readonly timeoutMs: number;
  private readonly graceMs: number;
  private readonly onWedged: WedgedHandler;

  constructor(input: {
    request: ExecuteRequest;
    window: ExecutionWindow;
    telemetry: DaemonTelemetry;
    timeoutMs: number;
    graceMs: number;
    onWedged: WedgedHandler;
  }) {
    this.request = input.request;
    this.window = input.window;
    this.telemetry = input.telemetry;
    this.timeoutMs = input.timeoutMs;
    this.graceMs = input.graceMs;
    this.onWedged = input.onWedged;
    const { request, telemetry } = input;
    this.context = new ExecutionContext(request.requestId, (stream, chunk) => {
      request.sink(stream, chunk);
      telemetry.requestProgress({ requestId: request.requestId, stream, bytes: chunk.byteLength });
    });
  }

  start(): CommandExecution {
    // 124, the `timeout(1)` convention, so scripts can tell a timeout apart
    // from both a command failure (1) and a client cancel (130).
    const timeout = setTimeout(() => {
      this.abort({
        code: 124,
        note: `langwatch: request timed out after ${Math.round(this.timeoutMs / 1000)}s; the daemon abandoned it\n`,
      });
    }, this.timeoutMs);
    timeout.unref();

    const completed = this.run();

    // The promise the server awaits: whichever of "the command finished" or
    // "the client cancelled" happens first.
    const raced = new Promise<number>((resolve, reject) => {
      const finish = (code: number): void => {
        clearTimeout(timeout);
        resolve(code);
      };
      this.settle = finish;
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
      cancel: (code: number) => this.abort({ code }),
    };
  }

  /**
   * Hand the execution window back. Exactly once, and only ever from a point
   * at which the command's own promise chain has actually settled.
   */
  private releaseOnce(): void {
    if (this.abandonTimer) {
      clearTimeout(this.abandonTimer);
      this.abandonTimer = undefined;
    }
    const release = this.releaseWindow;
    this.releaseWindow = undefined;
    release?.();
  }

  /**
   * The abandoned command still holds the window; this bounds how long. Nothing
   * here waits on the CALLER — they already have their 124/130 — it only stops
   * a command that never settles from keeping the daemon usable for nobody.
   */
  private armAbandonGrace(): void {
    // Safe only because the post-acquire `cancelled` check re-reads before
    // starting work, releasing any window taken in the gap between admission
    // and cancellation; delete it and this early return becomes a permanent
    // wedge (see runner.unit.test.ts).
    if (this.releaseWindow === undefined || this.abandonTimer) return;
    this.abandonTimer = setTimeout(() => {
      this.abandonTimer = undefined;
      this.onWedged({ requestId: this.request.requestId, graceMs: this.graceMs });
    }, this.graceMs);
    this.abandonTimer.unref();
  }

  private abort({ code, note }: { code: number; note?: string }): void {
    if (this.context.isFinished) return;
    this.cancelled = true;
    if (note !== undefined) {
      this.context.write("stderr", Buffer.from(note, "utf8"));
    }
    // Finalising first is what actually enforces the cancellation: every
    // subsequent write from the abandoned command is dropped on the floor.
    this.context.finalize(code);
    // Wakes a request still QUEUED for its window; a no-op otherwise.
    this.abortController.abort();
    // The caller settles now, but the WINDOW stays held: node can't unwind the
    // abandoned chain, which will still read `process.cwd()`/`process.env`.
    // `run`'s `finally` releases it once work truly settles; `armAbandonGrace`
    // bounds the rest.
    this.settle?.(code);
    this.armAbandonGrace();
  }

  private async run(): Promise<number> {
    const { request, context, telemetry } = this;
    const startedAt = Date.now();

    // May reject when the caller's cwd no longer exists. The server turns
    // that into a `fallback` frame — no output has been emitted yet, so the
    // client can safely re-run the command itself.
    let release: (() => void) | undefined;
    try {
      release = await this.window.acquire({
        request: { cwd: request.cwd, env: request.env, colorLevel: request.colorLevel },
        signal: this.abortController.signal,
      });
    } catch (error) {
      // Aborted while queued: the cancel/timeout path already settled the
      // caller; there is nothing left to report.
      if (this.cancelled) return context.exitCode;
      throw error;
    }
    this.releaseWindow = release;

    // Admitted at the same moment the abort fired. Don't start the work.
    if (this.cancelled) {
      this.releaseOnce();
      return context.exitCode;
    }

    telemetry.requestStarted({
      requestId: request.requestId,
      args: request.args,
      cwd: request.cwd,
    });

    let failure: unknown;
    try {
      failure = await runProgram({ request, context });
    } finally {
      // The ONLY place a window taken by a running command is handed back —
      // including for a command abandoned long ago. See the note in `abort`.
      this.releaseOnce();
    }

    telemetry.requestFinished({
      requestId: request.requestId,
      exitCode: context.exitCode,
      durationMs: Date.now() - startedAt,
      error: failure,
      cancelled: this.cancelled,
    });

    return context.exitCode;
  }
}
