/**
 * The thin client: talk to the daemon if it is there, and never, ever break if
 * it is not.
 *
 * Loaded on every CLI invocation, so it imports node builtins and nothing else.
 */

import * as net from "node:net";

import {
  encodeFrame,
  FrameDecoder,
  PROTOCOL_VERSION,
  type ClientFrame,
  type ServerFrame,
} from "./protocol";

/** Connecting to a socket on the local filesystem is sub-millisecond; if it is not, something is wrong and we should just run the command. */
const CONNECT_TIMEOUT_MS = 500;
/** The daemon answers a handshake without touching the network. */
const HANDSHAKE_TIMEOUT_MS = 1_000;

/**
 * Output is buffered until the command finishes, then flushed in one go.
 *
 * This is what makes the fallback airtight: if the daemon dies (or the socket
 * breaks, or the handshake is refused) at ANY point before the `exit` frame,
 * nothing has been written to the caller's stdout yet, so we can re-run the
 * command in-process with zero risk of duplicated or truncated output.
 *
 * The buffer is capped. A command with a genuinely large stdout (`trace export`)
 * flushes early and "commits" — from that point on we are streaming and can no
 * longer fall back, which is the correct trade: we would rather stream 200MB
 * than hold it in memory for a fallback that has never been needed.
 */
const DEFAULT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export type DaemonExecOutcome =
  | { served: true; exitCode: number }
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
  maxBufferBytes?: number;
  /** Where served output goes. Injectable for tests. */
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

interface PendingChunk {
  stream: "stdout" | "stderr";
  data: Buffer;
}

/**
 * Try to have the daemon run this command.
 *
 * Resolves `{ served: false }` for every failure mode there is — no socket, a
 * stale socket, a refused handshake, a daemon that died mid-command before
 * committing output. The caller runs the command in-process in all of them.
 */
export async function execViaDaemon(
  options: DaemonExecOptions,
): Promise<DaemonExecOutcome> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;

  return new Promise<DaemonExecOutcome>((resolve) => {
    const socket = net.connect(options.socketPath);
    const decoder = new FrameDecoder<ServerFrame>();

    const buffered: PendingChunk[] = [];
    let bufferedBytes = 0;
    /** Once true, output has reached the caller and we can no longer fall back. */
    let committed = false;
    let settled = false;
    let handshakeTimer: NodeJS.Timeout | undefined;
    let cancelled = false;

    const send = (frame: ClientFrame): void => {
      if (!socket.destroyed) socket.write(encodeFrame(frame));
    };

    const flush = (): void => {
      for (const chunk of buffered) {
        (chunk.stream === "stdout" ? stdout : stderr).write(chunk.data);
      }
      buffered.length = 0;
      bufferedBytes = 0;
    };

    const settle = (outcome: DaemonExecOutcome): void => {
      if (settled) return;
      settled = true;
      if (handshakeTimer) clearTimeout(handshakeTimer);
      removeSignalHandlers();
      socket.destroy();
      resolve(outcome);
    };

    const onSignal = (): void => {
      cancelled = true;
      // Tell the daemon to abandon the command rather than orphaning it, then
      // let the `exit` frame (code 130) settle us normally.
      send({ t: "cancel" });
      // If the daemon does not answer promptly, exit anyway — a Ctrl-C must
      // never hang.
      setTimeout(() => {
        if (committed) flush();
        settle({ served: true, exitCode: 130 });
      }, 500).unref();
    };

    const removeSignalHandlers = (): void => {
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      if (!committed) settle({ served: false, reason: "connect-timeout" });
    });

    socket.on("error", (error: NodeJS.ErrnoException) => {
      if (committed) {
        // Output is already on its way to the caller; re-running would duplicate
        // it. Surface the failure honestly instead.
        stderr.write(
          `langwatch: daemon connection lost mid-command (${error.code ?? error.message})\n`,
        );
        settle({ served: true, exitCode: 1 });
        return;
      }
      settle({ served: false, reason: `connect-failed:${error.code ?? "unknown"}` });
    });

    socket.on("close", () => {
      if (settled) return;
      if (committed) {
        stderr.write("langwatch: daemon closed the connection mid-command\n");
        settle({ served: true, exitCode: 1 });
        return;
      }
      settle({ served: false, reason: "closed-before-exit" });
    });

    socket.on("connect", () => {
      // Clear the connect timeout; the handshake gets its own.
      socket.setTimeout(0);
      process.on("SIGINT", onSignal);
      process.on("SIGTERM", onSignal);

      handshakeTimer = setTimeout(() => {
        settle({ served: false, reason: "handshake-timeout" });
      }, HANDSHAKE_TIMEOUT_MS);
      handshakeTimer.unref();

      // Pipelined: the daemon reads frames in order and will not touch `exec`
      // unless `hello` passed. Saves a round trip on the hot path.
      send({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        cliVersion: options.cliVersion,
        build: options.build,
        fingerprint: options.fingerprint,
      });
      send({
        t: "exec",
        args: options.args,
        cwd: options.cwd,
        env: options.env,
        colorLevel: options.colorLevel,
      });
    });

    socket.on("data", (chunk: Buffer) => {
      let frames: ServerFrame[];
      try {
        frames = decoder.push(chunk);
      } catch {
        settle({ served: false, reason: "protocol-error" });
        return;
      }

      for (const frame of frames) {
        switch (frame.t) {
          case "hello-ok": {
            if (handshakeTimer) clearTimeout(handshakeTimer);
            break;
          }
          case "hello-err": {
            if (handshakeTimer) clearTimeout(handshakeTimer);
            settle({
              served: false,
              reason: `handshake-refused:${frame.reason}`,
              // A stale daemon from a previous CLI version must not linger:
              // it would keep answering (and refusing) every invocation until
              // its idle timeout, and it is holding credentials.
              evict: frame.reason === "version-skew" || frame.reason === "protocol-skew",
            });
            break;
          }
          case "fallback": {
            settle({ served: false, reason: `daemon-declined:${frame.reason}` });
            break;
          }
          case "out":
          case "err": {
            if (cancelled) break;
            const data = Buffer.from(frame.d, "base64");
            const stream = frame.t === "out" ? "stdout" : "stderr";
            if (committed) {
              (stream === "stdout" ? stdout : stderr).write(data);
              break;
            }
            buffered.push({ stream, data });
            bufferedBytes += data.byteLength;
            if (bufferedBytes > maxBufferBytes) {
              committed = true;
              flush();
            }
            break;
          }
          case "exit": {
            flush();
            settle({ served: true, exitCode: frame.code });
            break;
          }
          case "status-ok":
            break;
        }
        if (settled) return;
      }
    });
  });
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
export async function requestStatus(
  socketPath: string,
): Promise<DaemonStatus | null> {
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
 * Ask a running daemon to shut down. Resolves true if one was there to ask.
 *
 * Deliberately does not require a handshake: this is also how a NEWER client
 * evicts an OLDER daemon, which by definition cannot agree on the version.
 */
export async function requestStop(socketPath: string): Promise<boolean> {
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
