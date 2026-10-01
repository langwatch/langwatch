/**
 * The thin client: talk to the daemon if it's there, and never break if it's not. Loaded
 * on every CLI invocation, so it imports node builtins and its own sibling modules only.
 */

import * as net from "node:net";
import { clearTimeout, setTimeout } from "node:timers";

import { inspectSocketTrust } from "./identity";
import {
  encodeFrame,
  FrameDecoder,
  PROTOCOL_VERSION,
  type ClientFrame,
  type ServerFrame,
} from "./protocol";

/**
 * Connecting to a socket on the local filesystem is sub-millisecond; if it is not,
 * something is wrong and we should just run the command.
 */
const CONNECT_TIMEOUT_MS = 500;
/** The daemon answers a handshake without touching the network. */
const HANDSHAKE_TIMEOUT_MS = 1_000;

/**
 * The whole request, from connect to `exit`, must finish inside this: nothing else bounds
 * it after `hello-ok`, and output is held back until the command finishes. 25s leaves
 * margin under a 30s harness deadline and clears the CLI's longest in-command limit.
 */
const REQUEST_TIMEOUT_MS = 25_000;

/**
 * What the caller sees when the deadline trips: names the failure, the deadline, and how
 * to run without a daemon — the shape it replaces (no output at all) told the caller
 * nothing and read as the CLI producing an empty result.
 */
const REQUEST_TIMEOUT_MESSAGE =
  `langwatch: the daemon accepted this command and did not answer within ${REQUEST_TIMEOUT_MS / 1000}s. ` +
  "Nothing it produced is printed, because a partial result is worse than none.\n" +
  "langwatch: run again with LANGWATCH_NO_DAEMON=1 to run the command in this process. " +
  "The wedged daemon was asked to stop, so the next command starts a fresh one.\n";

/**
 * The exit status of a command the client abandoned at its deadline: the same status the
 * daemon uses when it abandons a request at its own per-request timeout, and the shell
 * convention for a timeout-ended command.
 */
const REQUEST_TIMEOUT_EXIT_CODE = 124;

/**
 * Output is buffered until the command finishes, so a daemon failure at any point before
 * the `exit` frame can be re-run in-process with zero risk of duplicated or truncated
 * output. The buffer is capped: a large command (`trace export`) streams past it and "commits".
 */
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export type DaemonExecOutcome =
  | { served: true; exitCode: number; evict?: boolean }
  | { served: false; reason: string; evict?: boolean };

export interface DaemonExecOptions {
  socketPath: string;
  fingerprint: string;
  cliVersion: string;
  /** Identity of the code this client is running. See resolveBuildId. */
  build: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  colorLevel: number;
  /**
   * The bin this client was invoked as (`process.argv[1]`), so the daemon can
   * title usage and error output with the caller's name rather than its own.
   * See `ExecFrame.bin`.
   */
  bin?: string;
  maxBufferBytes?: number;
  /** How long the whole request may take. Injectable for tests. */
  requestTimeoutMs?: number;
  /** Where served output goes. Injectable for tests. */
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

interface PendingChunk {
  stream: "stdout" | "stderr";
  data: Buffer;
}

/**
 * Try to have the daemon run this command. Resolves `{ served: false }` for every failure
 * mode — no socket, a stale socket, a refused handshake, a daemon that died mid-command
 * before committing output — and the caller runs the command in-process for all of them.
 */
export async function execViaDaemon(options: DaemonExecOptions): Promise<DaemonExecOutcome> {
  // BEFORE connect, and above all before the pipelined `exec` hands over args,
  // cwd and the forwarded LANGWATCH_* env: the socket must be ours (identity.ts
  // inspectSocketTrust). An untrusted socket is exactly "no daemon available".
  const untrusted = inspectSocketTrust(options.socketPath);
  if (untrusted) return { served: false, reason: untrusted };

  return new Promise<DaemonExecOutcome>((resolve) => {
    new DaemonRequest({ options, resolve }).start();
  });
}

/** One command served over the daemon socket, buffered until its output commits. */
class DaemonRequest {
  private readonly options: DaemonExecOptions;
  private readonly resolve: (outcome: DaemonExecOutcome) => void;
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly maxBufferBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly socket: net.Socket;
  private readonly decoder = new FrameDecoder<ServerFrame>();
  private readonly buffered: PendingChunk[] = [];
  private bufferedBytes = 0;
  /** Once true, output has reached the caller and we can no longer fall back. */
  private committed = false;
  private settled = false;
  private handshakeTimer: NodeJS.Timeout | undefined;
  private requestTimer: NodeJS.Timeout | undefined;
  private cancelled = false;
  private readonly onSignal = (): void => {
    this.cancelled = true;
    // Tell the daemon to abandon the command rather than orphaning it, then
    // let the `exit` frame (code 130) settle us normally.
    this.send({ t: "cancel" });
    // If the daemon does not answer promptly, exit anyway: a Ctrl-C must never hang.
    setTimeout(() => {
      if (this.committed) this.flush();
      this.settle({ served: true, exitCode: 130 });
    }, 500).unref();
  };

  constructor({
    options,
    resolve,
  }: {
    options: DaemonExecOptions;
    resolve: (outcome: DaemonExecOutcome) => void;
  }) {
    this.options = options;
    this.resolve = resolve;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.socket = net.connect(options.socketPath);
  }

  start(): void {
    const { socket } = this;
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      if (!this.committed) this.settle({ served: false, reason: "connect-timeout" });
    });
    socket.on("error", (error: NodeJS.ErrnoException) => this.lost(error));
    socket.on("close", () => this.closed());
    socket.on("connect", () => this.connected());
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
  }

  private send(frame: ClientFrame): void {
    if (!this.socket.destroyed) this.socket.write(encodeFrame(frame));
  }

  private write(stream: PendingChunk["stream"], data: Buffer): void {
    (stream === "stdout" ? this.stdout : this.stderr).write(data);
  }

  private flush(): void {
    for (const chunk of this.buffered) this.write(chunk.stream, chunk.data);
    this.buffered.length = 0;
    this.bufferedBytes = 0;
  }

  private settle(outcome: DaemonExecOutcome): void {
    if (this.settled) return;
    this.settled = true;
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.requestTimer) clearTimeout(this.requestTimer);
    process.removeListener("SIGINT", this.onSignal);
    process.removeListener("SIGTERM", this.onSignal);
    this.socket.destroy();
    this.resolve(outcome);
  }

  private lost(error: NodeJS.ErrnoException): void {
    if (this.committed) {
      // Output is already on its way to the caller; re-running would duplicate
      // it. Surface the failure honestly instead.
      this.stderr.write(
        `langwatch: daemon connection lost mid-command (${error.code ?? error.message})\n`,
      );
      this.settle({ served: true, exitCode: 1 });
      return;
    }
    this.settle({ served: false, reason: `connect-failed:${error.code ?? "unknown"}` });
  }

  private closed(): void {
    if (this.settled) return;
    if (this.committed) {
      this.stderr.write("langwatch: daemon closed the connection mid-command\n");
      this.settle({ served: true, exitCode: 1 });
      return;
    }
    this.settle({ served: false, reason: "closed-before-exit" });
  }

  private connected(): void {
    const { options } = this;
    // Clear the connect timeout; the handshake gets its own.
    this.socket.setTimeout(0);
    process.on("SIGINT", this.onSignal);
    process.on("SIGTERM", this.onSignal);

    this.handshakeTimer = setTimeout(() => {
      this.settle({ served: false, reason: "handshake-timeout" });
    }, HANDSHAKE_TIMEOUT_MS);
    this.handshakeTimer.unref();

    // Armed for the WHOLE request and cleared once output commits: from then
    // the caller reads bytes as they arrive, so a long command is visibly alive.
    // Evicted on expiry: it took an exec and stopped answering.
    this.requestTimer = setTimeout(() => {
      this.stderr.write(REQUEST_TIMEOUT_MESSAGE);
      this.settle({ served: true, exitCode: REQUEST_TIMEOUT_EXIT_CODE, evict: true });
    }, this.requestTimeoutMs);
    this.requestTimer.unref();

    // Pipelined: the daemon reads frames in order and will not touch `exec`
    // unless `hello` passed. Saves a round trip on the hot path.
    this.send({
      t: "hello",
      protocol: PROTOCOL_VERSION,
      cliVersion: options.cliVersion,
      build: options.build,
      fingerprint: options.fingerprint,
    });
    this.send({
      t: "exec",
      args: options.args,
      cwd: options.cwd,
      env: options.env,
      colorLevel: options.colorLevel,
      bin: options.bin,
    });
  }

  private receive(chunk: Buffer): void {
    let frames: ServerFrame[];
    try {
      frames = this.decoder.push(chunk);
    } catch {
      this.settle({ served: false, reason: "protocol-error" });
      return;
    }
    for (const frame of frames) {
      this.handleFrame(frame);
      if (this.settled) return;
    }
  }

  private handleFrame(frame: ServerFrame): void {
    switch (frame.t) {
      case "hello-ok":
        if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
        return;
      case "hello-err":
        if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
        this.settle({
          served: false,
          reason: `handshake-refused:${frame.reason}`,
          // A stale daemon from a previous CLI version must not linger: it
          // would refuse every invocation until its idle timeout, holding credentials.
          evict: frame.reason === "version-skew" || frame.reason === "protocol-skew",
        });
        return;
      case "fallback":
        return this.declined(frame.reason);
      case "out":
      case "err":
        if (this.cancelled) return;
        return this.output(frame.t === "out" ? "stdout" : "stderr", Buffer.from(frame.d, "base64"));
      case "exit":
        this.flush();
        this.settle({ served: true, exitCode: frame.code });
        return;
      case "status-ok":
        return;
    }
  }

  private declined(reason: string): void {
    if (!this.committed) {
      this.settle({ served: false, reason: `daemon-declined:${reason}` });
      return;
    }
    // The daemon declined AFTER our output was flushed past the buffer cap:
    // re-running would duplicate what the caller has seen, so we report the
    // output as incomplete and this exit status as ours.
    this.stderr.write(
      `langwatch: daemon stopped mid-command (${reason}); ` +
        `the output above is incomplete and this exit status is not the command's — please re-run\n`,
    );
    this.settle({ served: true, exitCode: 1 });
  }

  private output(stream: PendingChunk["stream"], data: Buffer): void {
    if (this.committed) {
      this.write(stream, data);
      return;
    }
    this.buffered.push({ stream, data });
    this.bufferedBytes += data.byteLength;
    if (this.bufferedBytes <= this.maxBufferBytes) return;
    this.committed = true;
    if (this.requestTimer) clearTimeout(this.requestTimer);
    this.flush();
  }
}

export interface DaemonStatus {
  pid: number;
  cliVersion: string;
  protocol: number;
  socketPath: string;
  uptimeMs: number;
  idleTimeoutMs: number;
  served: number;
  inflight: number;
}

/** Ask a running daemon for its stats. Resolves null when nothing is listening. */
export async function requestStatus(socketPath: string): Promise<DaemonStatus | null> {
  // A socket we do not own is not our daemon, so there is nothing to report.
  if (inspectSocketTrust(socketPath)) return null;

  return new Promise<DaemonStatus | null>((resolve) => {
    const socket = net.connect(socketPath);
    const decoder = new FrameDecoder<ServerFrame>();
    let settled = false;

    const settle = (status: DaemonStatus | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => settle(null));
    socket.on("error", () => settle(null));
    socket.on("close", () => settle(null));
    socket.on("connect", () => {
      socket.write(encodeFrame({ t: "status" }));
    });
    socket.on("data", (chunk: Buffer) => {
      let frames: ServerFrame[];
      try {
        frames = decoder.push(chunk);
      } catch {
        settle(null);
        return;
      }
      for (const frame of frames) {
        if (frame.t === "status-ok") {
          const { t: _t, ...status } = frame;
          settle(status);
          return;
        }
      }
    });
  });
}

/**
 * Ask a running daemon to shut down. Resolves true if one was there to ask. Deliberately
 * does not require a handshake: this is also how a NEWER client evicts an OLDER daemon,
 * which by definition cannot agree on the version.
 */
export async function requestStop(socketPath: string): Promise<boolean> {
  // Deliberately does not require a handshake — but it still requires a socket
  // that is ours. `stop` is an unauthenticated command; sending it to a
  // stranger's listener tells them we are here and nothing else useful.
  if (inspectSocketTrust(socketPath)) return false;

  return new Promise<boolean>((resolve) => {
    const socket = net.connect(socketPath);
    let connected = false;

    const settle = (stopped: boolean): void => {
      socket.destroy();
      resolve(stopped);
    };

    socket.setTimeout(HANDSHAKE_TIMEOUT_MS, () => settle(connected));
    socket.on("error", () => settle(false));
    socket.on("connect", () => {
      connected = true;
      socket.write(encodeFrame({ t: "stop" }));
    });
    // The daemon ends the connection as it shuts down; that is our ack.
    socket.on("close", () => resolve(connected));
  });
}
