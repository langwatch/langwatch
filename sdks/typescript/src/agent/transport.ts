/**
 * The connection the client speaks over, behind one small interface so the
 * client never depends on how the frames travel.
 *
 * Two transports carry the same frames. The WebSocket is the default and it
 * needs the `ws` package: the platform authenticates from the request
 * headers of the upgrade, and no global `WebSocket` constructor can send
 * them. HTTP long polling is for a network that blocks WebSockets: one POST
 * registers, a GET waits for the next frames, a POST carries the answers. It
 * speaks through the global `fetch` (Node 20+).
 */

import { createRequire } from "node:module";
import type { WebSocket as WsWebSocket } from "ws";

export const AGENT_TRANSPORTS = ["websocket", "http"] as const;
export type AgentTransport = (typeof AGENT_TRANSPORTS)[number];

/** The header the poll and frames requests carry the instance token in. */
export const INSTANCE_TOKEN_HEADER = "X-Agent-Instance-Token";

const isSet = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * The transport to start with: the explicit option, then
 * `LANGWATCH_AGENT_TRANSPORT`, else the WebSocket. Anything that is not
 * `http` is the WebSocket, which falls back to HTTP on its own when the
 * upgrade is refused.
 */
export function resolveTransport({
  explicit,
  env = process.env,
}: {
  explicit?: string;
  env?: NodeJS.ProcessEnv;
}): AgentTransport {
  const candidate = isSet(explicit) ? explicit : env.LANGWATCH_AGENT_TRANSPORT;
  return isSet(candidate) && candidate.trim().toLowerCase() === "http" ? "http" : "websocket";
}

export interface SocketLike {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  /** Drop the connection without a close handshake. */
  terminate: () => void;
  onOpen: (listener: () => void) => void;
  onMessage: (listener: (data: string) => void) => void;
  onClose: (listener: (code: number) => void) => void;
  onError: (listener: (error: unknown) => void) => void;
  /** The platform pings for liveness; the pong is automatic, this only reports it. */
  onPing: (listener: () => void) => void;
  /**
   * The upgrade was answered with an HTTP status instead of a switch of
   * protocols: a proxy in the way. Only `ws` can tell; the close follows.
   */
  onUpgradeRefused?: (listener: (status: number) => void) => void;
}

export type SocketFactory = (args: { url: string; headers: Record<string, string> }) => SocketLike;

/** Thrown when the `ws` package is not installed. */
export class NoWebSocketError extends Error {
  constructor() {
    super("the ws package is not installed, so no socket can carry the API key header");
    this.name = "NoWebSocketError";
  }
}

const textOf = (data: unknown): string => {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data);
};

const wrapWs = (socket: WsWebSocket): SocketLike => {
  const closeListeners: Array<(code: number) => void> = [];
  let closed = false;
  const emitClose = (code: number) => {
    if (closed) return;
    closed = true;
    for (const listener of closeListeners) listener(code);
  };
  socket.on("close", (code) => emitClose(code));
  return {
    send: (data) => socket.send(data),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    onOpen: (listener) => socket.on("open", listener),
    onMessage: (listener) => socket.on("message", (data) => listener(textOf(data))),
    onClose: (listener) => closeListeners.push(listener),
    onError: (listener) => socket.on("error", listener),
    onPing: (listener) => socket.on("ping", listener),
    onUpgradeRefused: (listener) =>
      socket.on("unexpected-response", (request, response) => {
        listener(response.statusCode ?? 0);
        // With a listener attached, `ws` leaves the request open and emits
        // no close of its own; both are finished here.
        response.resume();
        request.destroy();
        emitClose(1006);
      }),
  };
};

type WsConstructor = new (
  url: string,
  options: { headers: Record<string, string> },
) => WsWebSocket;

/**
 * The `ws` constructor, or null when the package cannot be loaded. It is
 * required rather than imported: a runtime or a bundle without `ws` must
 * reach the factory below and get one clear message, never fail while this
 * module loads.
 */
const wsConstructor = (): WsConstructor | null => {
  try {
    const loaded = createRequire(__filename)("ws") as { WebSocket?: unknown };
    return typeof loaded.WebSocket === "function" ? (loaded.WebSocket as WsConstructor) : null;
  } catch {
    return null;
  }
};

/**
 * Opens a socket with `ws`. A global `WebSocket` is no substitute: it takes
 * no request headers, the API key never travels in the URL, and the platform
 * would refuse every socket it opened.
 */
export const defaultSocketFactory: SocketFactory = ({ url, headers }) => {
  const Ws = wsConstructor();
  if (!Ws) throw new NoWebSocketError();
  return wrapWs(new Ws(url, { headers }));
};

// ---------------------------------------------------------------------------
// HTTP long polling
// ---------------------------------------------------------------------------

/** The close code the client reads as "register again at once". */
export const SESSION_LOST_CLOSE_CODE = 1012;

/** How a failed post of a frame is retried before the session is dropped. */
const POST_RETRY_DELAYS_MS = [250, 500, 1000];

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref());

export interface HttpLongPollOptions {
  /** `https://app.langwatch.ai/api/agents/connect`, the base the three routes hang off. */
  url: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
}

/**
 * The same frames over three requests. `send` of a register frame posts it
 * and starts the poll loop on the registered answer; `send` of any other
 * frame posts it in order; every frame a poll answers with is a message.
 * A poll that is refused, that fails or that names an unknown session ends
 * the connection the way a dropped socket would, and the client reconnects
 * with its own backoff, registering again.
 */
export class HttpLongPollSocket implements SocketLike {
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly messageListeners: Array<(data: string) => void> = [];
  private readonly closeListeners: Array<(code: number) => void> = [];
  private readonly errorListeners: Array<(error: unknown) => void> = [];
  private readonly pingListeners: Array<() => void> = [];
  private readonly inFlight = new Set<string>();
  private readonly polls = new AbortController();
  private outbox: Promise<void> = Promise.resolve();
  private token: string | null = null;
  private closed = false;
  private closeEmitted = false;
  /** Settled once the register was answered, so a frame sent before it waits. */
  private readonly registered: Promise<void>;
  private settleRegistered: () => void = () => undefined;

  constructor(options: HttpLongPollOptions) {
    this.url = options.url;
    this.headers = options.headers;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new Error("the HTTP transport needs a global fetch; run on Node 20 or later");
    }
    this.fetchImpl = fetchImpl;
    this.registered = new Promise<void>((resolve) => {
      this.settleRegistered = resolve;
    });
  }

  send(data: string): void {
    let frame: { type?: unknown; callId?: unknown };
    try {
      frame = JSON.parse(data) as { type?: unknown; callId?: unknown };
    } catch {
      return;
    }
    if (frame.type === "register") {
      void this.register(data);
      return;
    }
    if (frame.type === "ack" && typeof frame.callId === "string") this.inFlight.add(frame.callId);
    if (frame.type === "result" && typeof frame.callId === "string") this.inFlight.delete(frame.callId);
    this.outbox = this.outbox
      .then(() => this.registered)
      .then(() => this.post(data))
      .catch(() => undefined);
  }

  /** Stops polling, lets the frames already queued go out, then reports the close. */
  close(code = 1000): void {
    this.closed = true;
    this.polls.abort();
    void this.outbox.finally(() => this.emitClose(code));
  }

  terminate(): void {
    this.closed = true;
    this.polls.abort();
    this.emitClose(1006);
  }

  onOpen(listener: () => void): void {
    // There is nothing to open: the register frame is the first request.
    setTimeout(() => {
      if (!this.closed) listener();
    }, 0);
  }

  onMessage(listener: (data: string) => void): void {
    this.messageListeners.push(listener);
  }

  onClose(listener: (code: number) => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: (error: unknown) => void): void {
    this.errorListeners.push(listener);
  }

  onPing(listener: () => void): void {
    this.pingListeners.push(listener);
  }

  private requestHeaders(): Record<string, string> {
    return {
      ...this.headers,
      "Content-Type": "application/json",
      ...(this.token ? { [INSTANCE_TOKEN_HEADER]: this.token } : {}),
    };
  }

  private async register(data: string): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}/register`, {
        method: "POST",
        headers: this.requestHeaders(),
        body: data,
        signal: this.polls.signal,
      });
    } catch (error) {
      if (!this.closed) this.fail(`could not reach ${this.url}/register (${describe(error)})`, 1006);
      return;
    }
    const body = await this.jsonOf(response);
    const frame = body && typeof body.frame === "object" && body.frame !== null ? body.frame : null;
    if (!frame) {
      this.fail(`the register request was answered with HTTP ${response.status}`, 1006);
      return;
    }
    if (typeof body?.instanceToken === "string") this.token = body.instanceToken;
    this.settleRegistered();
    this.emitMessage(JSON.stringify(frame));
    if ((frame as { type?: unknown }).type === "registered" && this.token) void this.pollLoop();
  }

  private async pollLoop(): Promise<void> {
    while (!this.closed && this.token) {
      const query = this.inFlight.size > 0 ? `?inFlight=${encodeURIComponent([...this.inFlight].join(","))}` : "";
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.url}/poll${query}`, {
          method: "GET",
          headers: this.requestHeaders(),
          signal: this.polls.signal,
        });
      } catch (error) {
        if (!this.closed) this.fail(`the poll failed (${describe(error)})`, 1006);
        return;
      }
      if (this.closed) return;
      if (response.status === 410) {
        this.fail("the platform no longer knows this instance, registering again", SESSION_LOST_CLOSE_CODE);
        return;
      }
      const body = await this.jsonOf(response);
      if (!response.ok) {
        const refused = body && typeof body.frame === "object" && body.frame !== null ? body.frame : null;
        if (refused) {
          // The platform refused the credential: the client prints and gives up.
          this.emitMessage(JSON.stringify(refused));
          return;
        }
        this.fail(`the poll was answered with HTTP ${response.status}`, 1006);
        return;
      }
      const frames = Array.isArray(body?.frames) ? (body.frames as unknown[]) : [];
      for (const frame of frames) {
        const entry = frame as { type?: unknown; callId?: unknown };
        if (entry.type === "cancel" && typeof entry.callId === "string") this.inFlight.delete(entry.callId);
        this.emitMessage(JSON.stringify(frame));
      }
      for (const listener of this.pingListeners) listener();
    }
  }

  private async post(data: string): Promise<void> {
    if (!this.token) return;
    for (let attempt = 0; ; attempt += 1) {
      let response: Response | null = null;
      try {
        response = await this.fetchImpl(`${this.url}/frames`, {
          method: "POST",
          headers: this.requestHeaders(),
          body: `{"frames":[${data}]}`,
        });
      } catch {
        response = null;
      }
      if (response?.ok) return;
      if (response?.status === 410) {
        this.fail("the platform no longer knows this instance, registering again", SESSION_LOST_CLOSE_CODE);
        return;
      }
      if (response && response.status < 500) return;
      const delay = POST_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        this.fail(`a frame could not be posted after ${attempt} retries`, 1006);
        return;
      }
      await wait(delay);
    }
  }

  private async jsonOf(response: Response): Promise<Record<string, unknown> | null> {
    try {
      const parsed = (await response.json()) as unknown;
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  private fail(message: string, code: number): void {
    for (const listener of this.errorListeners) listener(new Error(message));
    this.closed = true;
    this.polls.abort();
    this.emitClose(code);
  }

  private emitMessage(data: string): void {
    for (const listener of this.messageListeners) listener(data);
  }

  private emitClose(code: number): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    // A frame still waiting for the register answer is released; with no
    // token it is dropped, the way a frame on a closed socket is.
    this.settleRegistered();
    for (const listener of this.closeListeners) listener(code);
  }
}
