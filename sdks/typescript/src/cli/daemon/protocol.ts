/**
 * Wire protocol between the CLI client and the daemon: newline-delimited
 * JSON, output chunks base64'd (stdout isn't guaranteed valid UTF-8). One
 * connection, one request. Dependency-free -- it loads on every invocation.
 */
import { StringDecoder } from "node:string_decoder";

/**
 * Bumped whenever the frame shapes change incompatibly. A client refuses to
 * talk to a daemon whose protocol differs, independently of the CLI version
 * check, so a hand-rolled or in-flight-upgraded daemon can never half-serve.
 */
export const PROTOCOL_VERSION = 1;

/** Client -> daemon: opening frame; always the first frame on a connection. */
export interface HelloFrame {
  t: "hello";
  protocol: number;
  /** Human-readable CLI version of the *client*, for error messages. */
  cliVersion: string;
  /**
   * Identity of the CODE the client is running: version + entrypoint
   * size/mtime. Must equal the daemon's, or it is stale and gets evicted --
   * the semver alone does not move when a bundle is rebuilt. See `resolveBuildId`.
   */
  build: string;
  /** sha256 of (endpoint, apiKey, uid). See identity.ts. */
  fingerprint: string;
}

/** Client -> daemon: run this command. Sent immediately after `hello`. */
export interface ExecFrame {
  t: "exec";
  /** User-level args, i.e. process.argv.slice(2). Parsed with commander's `from: "user"`. */
  args: string[];
  /** The CALLER's working directory. Commands that touch local files depend on it. */
  cwd: string;
  /** Allowlisted env overlay (see eligibility.ts). Never the caller's whole environment. */
  env: Record<string, string>;
  /** Chalk colour level the caller's process would have resolved (0-3). */
  colorLevel: number;
  /**
   * The CALLER's `process.argv[1]` — the bin it was invoked as. Two bin names
   * (`lw`, `langwatch`) share one daemon, so without this the daemon's own bin
   * name leaks into usage/error text for the other caller. Optional field.
   */
  bin?: string;
}

/** Client -> daemon: cancel the in-flight request on this connection. */
export interface CancelFrame {
  t: "cancel";
}

/** Client -> daemon: ask the daemon to shut down (used by `daemon stop` + skew eviction). */
export interface StopFrame {
  t: "stop";
}

/** Client -> daemon: report liveness/stats (used by `daemon status`). */
export interface StatusFrame {
  t: "status";
}

export type ClientFrame = HelloFrame | ExecFrame | CancelFrame | StopFrame | StatusFrame;

/** Daemon -> client: handshake accepted. */
export interface HelloOkFrame {
  t: "hello-ok";
  protocol: number;
  cliVersion: string;
  build: string;
  pid: number;
}

/**
 * Daemon -> client: handshake refused. The client always falls back
 * in-process; `reason` only decides whether it also evicts the daemon.
 */
export interface HelloErrFrame {
  t: "hello-err";
  reason: "protocol-skew" | "version-skew" | "identity-mismatch" | "shutting-down";
  /** The daemon's own CLI version, so the client can log a useful message. */
  cliVersion: string;
}

/** Daemon -> client: a chunk of the command's stdout (base64). */
export interface OutFrame {
  t: "out";
  d: string;
}

/** Daemon -> client: a chunk of the command's stderr (base64). */
export interface ErrFrame {
  t: "err";
  d: string;
}

/** Daemon -> client: the command finished; `code` is its exit status. */
export interface ExitFrame {
  t: "exit";
  code: number;
}

/**
 * Daemon -> client: "I cannot serve this faithfully, run it yourself." Only
 * ever sent BEFORE any `out`/`err` frame, so the client falls back with zero
 * risk of duplicated output.
 */
export interface FallbackFrame {
  t: "fallback";
  reason: string;
}

export interface StatusOkFrame {
  t: "status-ok";
  pid: number;
  cliVersion: string;
  protocol: number;
  socketPath: string;
  uptimeMs: number;
  idleTimeoutMs: number;
  /** Requests served since boot (completed, any exit code). */
  served: number;
  /** Requests currently executing. */
  inflight: number;
}

export type ServerFrame =
  | HelloOkFrame
  | HelloErrFrame
  | OutFrame
  | ErrFrame
  | ExitFrame
  | FallbackFrame
  | StatusOkFrame;

export type AnyFrame = ClientFrame | ServerFrame;

/** Serialise a frame to its newline-terminated wire form. */
export function encodeFrame(frame: AnyFrame): string {
  return JSON.stringify(frame) + "\n";
}

/**
 * Incremental newline-delimited-JSON reader: socket reads split anywhere, so
 * a frame can span several chunks and several frames can arrive in one.
 * Feed raw buffers, get whole frames.
 */
export class FrameDecoder<T extends AnyFrame = AnyFrame> {
  private buffer = "";
  /**
   * A socket can split a multi-byte UTF-8 sequence across two reads;
   * `chunk.toString("utf8")` per chunk would resolve each half to U+FFFD,
   * silently mangling the frame. `StringDecoder` holds the incomplete tail.
   */
  private readonly utf8 = new StringDecoder("utf8");

  /**
   * @param maxLineBytes Guard against a peer that never sends a newline.
   *   Exceeding it throws rather than growing the buffer without bound.
   */
  constructor(private readonly maxLineBytes = 64 * 1024 * 1024) {}

  push(chunk: Buffer | string): T[] {
    this.buffer += typeof chunk === "string" ? chunk : this.utf8.write(chunk);
    if (this.buffer.length > this.maxLineBytes) {
      this.buffer = "";
      throw new Error("daemon protocol: frame exceeded maximum size");
    }

    const frames: T[] = [];
    let newlineAt = this.buffer.indexOf("\n");
    while (newlineAt !== -1) {
      const line = this.buffer.slice(0, newlineAt);
      this.buffer = this.buffer.slice(newlineAt + 1);
      if (line.trim() !== "") {
        frames.push(JSON.parse(line) as T);
      }
      newlineAt = this.buffer.indexOf("\n");
    }
    return frames;
  }
}
