/**
 * Running a CLI command inside a long-lived process, faithfully. Owns the
 * three process-globals between calling the command and behaving like a
 * fresh CLI process: stdout/stderr, process.exit, cwd + environment.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { StringDecoder } from "node:string_decoder";

import chalk from "chalk";

import { runWithCredentialHolder } from "@/internal/credentialContext";

import { currentOutputScope, withOutputScope } from "../utils/errorOutput";
import { AGENT_MODE_ENV_VARS } from "../utils/output";

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
 * Thrown by patched `process.exit` to unwind the stack. ExecutionContext
 * finalizes on FIRST exit and drops all subsequent writes.
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
 * One in-flight command, owning its output and exit code. `finalize` is
 * first-write-wins and irreversible, as real process termination would be.
 */
export class ExecutionContext {
  private finished = false;
  private code: number | null = null;
  /** Trailing partial SGR sequences held back per stream (see `stripSgr`). */
  private readonly pendingEscape: Record<OutputStream, Buffer | null> = {
    stdout: null,
    stderr: null,
  };
  /**
   * Per-stream UTF-8 decoders for the colour-stripping path: a multibyte
   * character split across two writes must survive the split, which
   * `chunk.toString("utf8")` per write would not (each half decodes to U+FFFD).
   */
  private readonly decoders: Record<OutputStream, StringDecoder> = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
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
    if (scope && !scope.hasColor) {
      chunk = this.stripSgr({ stream, chunk });
    }
    this.sink(stream, chunk);
  }

  /**
   * Strips SGR sequences, holding back a trailing PARTIAL one and
   * prepending it to the next chunk -- a split escape would otherwise leak
   * half of it. A partial left at finalize is never complete.
   */
  private stripSgr({ stream, chunk }: { stream: OutputStream; chunk: Buffer }): Buffer {
    // SGR sequences are pure ASCII, so the held-back partial decodes safely on
    // its own; the chunk goes through the stream's StringDecoder so a
    // multibyte character split across writes is reassembled, not corrupted.
    const held = this.pendingEscape[stream];
    let text = (held === null ? "" : held.toString("utf8")) + this.decoders[stream].write(chunk);
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
    // Flush any bytes the decoders are still holding (a multibyte character
    // truncated by the stream's end surfaces as U+FFFD, exactly as a terminal
    // would render it). A dangling partial SGR is NOT flushed — it is never a
    // complete sequence, so nothing visible is lost.
    for (const stream of ["stdout", "stderr"] as const) {
      const rest = this.decoders[stream].end();
      if (rest) this.sink(stream, Buffer.from(rest, "utf8"));
    }
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
 * Runs `fn` with `context` as the ambient execution context, entering a
 * fresh output scope so two concurrent requests can never clobber each
 * other's error format or colour.
 */
export function withExecutionContext<T>(context: ExecutionContext, fn: () => T): T {
  // A fresh credential holder per request: the resolver fills it later and the
  // request's own services read it, so a resolved device-session key never
  // reaches the shared env where a concurrent request could pick it up
  // (internal/credentialContext.ts).
  return storage.run(context, () => withOutputScope(() => runWithCredentialHolder(fn)));
}

let installed = false;

/**
 * Route process stdout/stderr writes to the current async request context.
 * Idempotent; returns an uninstall function.
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
        return (real as (...args: unknown[]) => boolean)(chunk, encodingOrCallback, callback);
      }

      const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : "utf8";
      const buffer = typeof chunk === "string" ? Buffer.from(chunk, encoding) : Buffer.from(chunk);
      context.write(stream, buffer);

      // Honour whichever of the two overloads the caller used, or the stream
      // contract (a write callback must always fire) is broken.
      const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
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
  const entries = Object.entries(request.env).toSorted(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  return JSON.stringify([request.cwd, request.colorLevel, entries]);
}

interface Waiter {
  key: string;
  request: WindowRequest;
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
}

/**
 * Concurrency model: batch requests by (cwd, env, colorLevel) tuple; matching
 * requests join immediately, non-matching queue. Prioritizes parallelism.
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
   * Wait until the process globals match `request`, then return a release function. Rejects
   * if the globals cannot be applied, which the server turns into a clean in-process fallback.
   * `signal` aborts the WAIT: a cancelled waiter is removed rather than wedging the window.
   */
  async acquire({
    request,
    signal,
  }: {
    request: WindowRequest;
    signal?: AbortSignal;
  }): Promise<() => void> {
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
    // switch: it's process-global mutable state, cheap insurance against a
    // mid-request mutation leaking into the next caller on a reused window.
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
    // The caller's LANGWATCH_* variables are authoritative: one the daemon
    // inherited but the caller lacks must not be visible. Same for
    // agent-mode markers -- a daemon spawned by an agent inherits
    // CLAUDECODE=1, and a later human caller must not be misread as one.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("LANGWATCH_")) {
        if (!(key in request.env)) delete process.env[key];
      } else if (AGENT_MODE_ENV_VAR_SET.has(key) && !(key in request.env)) delete process.env[key];
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
