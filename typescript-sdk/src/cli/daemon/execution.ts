/**
 * Running a CLI command inside a long-lived process, faithfully.
 *
 * Three process-global things stand between "call the command function" and
 * "behave exactly like a fresh CLI process": stdout/stderr, process.exit, and
 * the working directory + environment. This module owns all three.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import chalk from "chalk";

import { AGENT_MODE_ENV_VARS } from "../utils/output";
import { currentOutputScope, withOutputScope } from "../utils/errorOutput";

/** Set membership test for the strip rule in `applyWindow`. */
const AGENT_MODE_ENV_VAR_SET: ReadonlySet<string> = new Set(AGENT_MODE_ENV_VARS);

export type OutputStream = "stdout" | "stderr";
export type OutputSink = (stream: OutputStream, chunk: Buffer) => void;

/** ANSI SGR (colour/style) sequences — everything chalk emits. */
// eslint-disable-next-line no-control-regex -- matching the ESC control char is the whole point
const SGR_PATTERN = /\u001B\[[0-9;]*m/g;

/** A trailing PARTIAL SGR: ESC, or ESC[ + parameters with no `m` yet. */
// eslint-disable-next-line no-control-regex -- matching the ESC control char is the whole point
const PARTIAL_SGR_AT_END = /\u001B(?:\[[0-9;]*)?$/;

/**
 * Thrown by the patched `process.exit` to unwind the command's stack.
 *
 * It cannot be an ordinary Error that callers meaningfully catch, but the CLI's
 * command actions are full of `try { … } catch (e) { console.error(e); process.exit(1) }`,
 * and a `catch` catches everything. That is fine, and is exactly why
 * `ExecutionContext` finalises on the FIRST exit and drops every write after
 * it: in a real process, `process.exit(1)` inside `checkApiKey()` terminates
 * immediately and the enclosing catch block never gets to print anything. We
 * reproduce that by discarding whatever the unwinding stack emits.
 */
export class DaemonExitSignal extends Error {
  readonly isDaemonExitSignal = true;

  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "DaemonExitSignal";
  }
}

export function isDaemonExitSignal(error: unknown): error is DaemonExitSignal {
  return (
    error instanceof DaemonExitSignal ||
    (typeof error === "object" &&
      error !== null &&
      (error as { isDaemonExitSignal?: boolean }).isDaemonExitSignal === true)
  );
}

/**
 * One in-flight command. Owns that command's output and its exit code.
 *
 * `finalize` is first-write-wins and irreversible, which is what makes exit
 * semantics faithful: the first `process.exit(code)` decides the status and
 * silences everything that comes after, just as process termination would.
 */
export class ExecutionContext {
  private finished = false;
  private code: number | null = null;
  /** Trailing partial SGR sequences held back per stream (see `stripSgr`). */
  private readonly pendingEscape: Record<OutputStream, Buffer | null> = {
    stdout: null,
    stderr: null,
  };

  constructor(
    readonly id: string,
    private readonly sink: OutputSink,
  ) {}

  write(stream: OutputStream, chunk: Buffer): void {
    if (this.finished) return;
    // Agent mode turns colour off per request (utils/errorOutput.ts
    // disableOutputColor): chalk.level is process-global and cannot be scoped
    // to one request, so the request's bytes have their SGR (colour/style)
    // sequences stripped here instead of touching it.
    const scope = currentOutputScope();
    if (scope && !scope.color) {
      chunk = this.stripSgr(stream, chunk);
    }
    this.sink(stream, chunk);
  }

  /**
   * Strip SGR sequences, holding back a trailing PARTIAL one (ESC, or
   * ESC[ + parameters with no terminating `m` yet) and prepending it to the
   * next chunk on the same stream — an escape split across two writes would
   * otherwise leak half of it to the caller. A partial left dangling at
   * finalize is never a complete sequence, so nothing visible is lost.
   */
  private stripSgr(stream: OutputStream, chunk: Buffer): Buffer {
    const held = this.pendingEscape[stream];
    let text = (held === null ? "" : held.toString("utf8")) + chunk.toString("utf8");
    this.pendingEscape[stream] = null;

    const partial = PARTIAL_SGR_AT_END.exec(text);
    if (partial) {
      this.pendingEscape[stream] = Buffer.from(partial[0], "utf8");
      text = text.slice(0, -partial[0].length);
    }
    return Buffer.from(text.replace(SGR_PATTERN, ""), "utf8");
  }

  /** Record the exit status and silence further output. Idempotent. */
  finalize(code: number): void {
    if (this.finished) return;
    this.finished = true;
    this.code = code;
  }

  get exitCode(): number {
    return this.code ?? 0;
  }

  get isFinished(): boolean {
    return this.finished;
  }
}

const storage = new AsyncLocalStorage<ExecutionContext>();

/**
 * Run `fn` with `context` as the ambient execution context.
 *
 * Also enters a fresh output scope (utils/errorOutput.ts withOutputScope), so
 * the request's `--format`/`--agent` context lives in the same async scope as
 * its stdout/stderr routing and two concurrent requests cannot clobber each
 * other's error format or colour.
 */
export function withExecutionContext<T>(
  context: ExecutionContext,
  fn: () => T,
): T {
  return storage.run(context, () => withOutputScope(fn));
}

export function currentExecutionContext(): ExecutionContext | undefined {
  return storage.getStore();
}

let installed = false;

/**
 * Patch the process globals that a command writes to, routing them to whichever
 * request is currently executing.
 *
 * AsyncLocalStorage is what makes this safe under concurrency: `console.log`
 * ends up in `process.stdout.write`, and the store lookup there resolves to the
 * request whose async context we are running in — not to whichever request
 * happened to start last. Writes made outside any request (the daemon's own
 * logging) pass straight through to the real streams.
 *
 * Idempotent; returns an uninstall function for tests.
 */
export function installProcessInterceptors(): () => void {
  if (installed) return () => undefined;
  installed = true;

  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  const realExit = process.exit.bind(process);

  const intercept = (
    stream: OutputStream,
    real: typeof realStdoutWrite,
  ): typeof realStdoutWrite => {
    return ((
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      const context = storage.getStore();
      if (!context) {
        return (real as (...args: unknown[]) => boolean)(
          chunk,
          encodingOrCallback,
          callback,
        );
      }

      const encoding =
        typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
      const buffer =
        typeof chunk === "string"
          ? Buffer.from(chunk, encoding)
          : Buffer.from(chunk);
      context.write(stream, buffer);

      // Honour whichever of the two overloads the caller used, or the stream
      // contract (a write callback must always fire) is broken.
      const done =
        typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
      done?.();
      return true;
    }) as typeof realStdoutWrite;
  };

  process.stdout.write = intercept("stdout", realStdoutWrite);
  process.stderr.write = intercept("stderr", realStderrWrite);

  process.exit = ((code?: number): never => {
    const context = storage.getStore();
    if (!context) {
      // Not inside a request — this is the daemon's own shutdown path.
      return realExit(code);
    }
    context.finalize(code ?? 0);
    throw new DaemonExitSignal(context.exitCode);
  }) as typeof process.exit;

  return () => {
    process.stdout.write = realStdoutWrite;
    process.stderr.write = realStderrWrite;
    process.exit = realExit;
    installed = false;
  };
}

export interface WindowRequest {
  /** The CALLER's working directory. */
  cwd: string;
  /** Allowlisted env overlay from the caller. */
  env: Record<string, string>;
  /** Chalk level the caller's process resolved. */
  colorLevel: number;
}

function windowKey(request: WindowRequest): string {
  const entries = Object.entries(request.env).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return JSON.stringify([request.cwd, request.colorLevel, entries]);
}

interface Waiter {
  key: string;
  request: WindowRequest;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
}

/**
 * The concurrency model.
 *
 * `process.cwd()`, `process.env` and `chalk.level` are process-global, and
 * requests can disagree about all three. Node offers no per-async-context
 * working directory (`process.chdir` is not even available in worker threads),
 * so the only correct options are (a) serialise everything, or (b) let requests
 * that AGREE on the globals run together and make requests that disagree wait.
 *
 * (a) would be a regression: an agent that fans out five commands would get
 * them run back-to-back, which is slower than five cold processes running in
 * parallel. So this is (b), an "execution window":
 *
 *   - All requests currently executing share one (cwd, env, colorLevel) tuple.
 *   - A request matching the active tuple joins immediately — unbounded
 *     concurrency, which is the realistic case (one agent, one repo, fanning
 *     out reads).
 *   - A request with a different tuple queues, and the globals are re-applied
 *     for it once the current window drains.
 *   - Queued requests are FIFO, and a matching request will NOT jump an
 *     already-waiting non-matching one, so a busy same-cwd stream cannot starve
 *     a different-cwd caller.
 */
export class ExecutionWindow {
  private activeKey: string | null = null;
  private inflight = 0;
  private queue: Waiter[] = [];
  private readonly baselineEnv: Record<string, string | undefined>;

  constructor(private readonly baselineCwd: string = process.cwd()) {
    this.baselineEnv = { ...process.env };
  }

  get inflightCount(): number {
    return this.inflight;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  /**
   * Wait until the process globals match `request`, then return a release
   * function. Rejects if the globals cannot be applied (e.g. the caller's cwd
   * was deleted), which the server turns into a clean in-process fallback.
   *
   * `signal` aborts the WAIT: a queued waiter whose client has already
   * cancelled (or whose request timed out) is removed from the queue rather
   * than being admitted — and wedging the window — long after anyone stopped
   * listening for it.
   */
  async acquire(
    request: WindowRequest,
    signal?: AbortSignal,
  ): Promise<() => void> {
    const key = windowKey(request);

    // Queue behind anyone already waiting, even on a key match — otherwise a
    // steady stream of same-key requests would starve a different-key waiter.
    if (this.queue.length === 0 && (this.inflight === 0 || this.activeKey === key)) {
      return this.admit(key, request);
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { key, request, resolve, reject };
      this.queue.push(waiter);
      if (!signal) return;

      const onAbort = (): void => {
        const index = this.queue.indexOf(waiter);
        // Already admitted: the abort arrived too late, the release function
        // owns the lifecycle now.
        if (index === -1) return;
        this.queue.splice(index, 1);
        reject(new Error("request cancelled while queued"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private admit(key: string, request: WindowRequest): () => void {
    if (this.activeKey !== key) {
      this.applyWindow(request);
      this.activeKey = key;
    }
    // chalk.level is re-applied on every admission, not only on a window
    // switch: it is process-global mutable state, so this is cheap insurance
    // against ANY mid-request mutation leaking into the next caller on a
    // reused window. (Agent mode no longer mutates it — daemon-served
    // requests strip colour at the sink instead, see ExecutionContext.write —
    // but the in-process path and third-party code still can.)
    chalk.level = request.colorLevel as typeof chalk.level;
    this.inflight++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    this.inflight--;
    if (this.inflight > 0) return;
    this.drain();
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0]!;
      try {
        this.applyWindow(head.request);
        this.activeKey = head.key;
      } catch (error) {
        this.queue.shift();
        head.reject(error);
        continue;
      }

      // Admit the head and everyone else already waiting on the same window.
      const deferred: Waiter[] = [];
      for (const waiter of this.queue) {
        if (waiter.key === head.key) {
          this.inflight++;
          let released = false;
          waiter.resolve(() => {
            if (released) return;
            released = true;
            this.release();
          });
        } else {
          deferred.push(waiter);
        }
      }
      this.queue = deferred;
      return;
    }
    this.activeKey = null;
  }

  private applyWindow(request: WindowRequest): void {
    process.chdir(request.cwd);

    // Reset to the daemon's boot environment before overlaying the caller's.
    // Without the reset, `dotenv.config()` — which commands call, and which
    // writes into process.env permanently — would leak one caller's .env into
    // the next caller's request.
    for (const key of Object.keys(process.env)) {
      if (!(key in this.baselineEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(this.baselineEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // The caller's LANGWATCH_* variables are authoritative: a variable the
    // daemon inherited but the caller does not have must not be visible. The
    // same goes for the agent-mode markers (utils/output.ts
    // AGENT_MODE_ENV_VARS): a daemon auto-spawned BY an agent inherits e.g.
    // CLAUDECODE=1 into its baseline, and a later HUMAN caller must not be
    // misread as an agent (compact JSON, no spinners) because of it.
    for (const key of Object.keys(process.env)) {
      if (
        (key.startsWith("LANGWATCH_") || AGENT_MODE_ENV_VAR_SET.has(key)) &&
        !(key in request.env)
      ) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, request.env);

    // chalk resolves its level once at import; in the daemon that would be the
    // daemon's own (null) stdio. Set it to whatever the caller's process would
    // have resolved so colour output is byte-identical.
    chalk.level = request.colorLevel as typeof chalk.level;
  }

  /** Restore the daemon's own globals. Used on shutdown and by tests. */
  reset(): void {
    process.chdir(this.baselineCwd);
    for (const key of Object.keys(process.env)) {
      if (!(key in this.baselineEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(this.baselineEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    this.activeKey = null;
  }
}
