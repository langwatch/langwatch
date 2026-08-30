/**
 * The socket the client speaks over, behind one small interface so the
 * client never depends on which WebSocket implementation opened it.
 *
 * `ws` is preferred because it carries the request headers the platform
 * authenticates with. The runtime's global `WebSocket` (Node 22+, Bun, Deno)
 * is the fallback when `ws` exposes no constructor, for example under a
 * bundler that stubbed it out; that constructor takes no headers, so the
 * platform can only accept it when the key travels another way.
 */

import { WebSocket as WsWebSocket } from "ws";

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
}

export type SocketFactory = (args: { url: string; headers: Record<string, string> }) => SocketLike;

/** Thrown when neither `ws` nor a global WebSocket can open the socket. */
export class NoWebSocketError extends Error {
  constructor() {
    super("no WebSocket implementation is available in this runtime");
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

const wrapWs = (socket: WsWebSocket): SocketLike => ({
  send: (data) => socket.send(data),
  close: (code, reason) => socket.close(code, reason),
  terminate: () => socket.terminate(),
  onOpen: (listener) => socket.on("open", listener),
  onMessage: (listener) => socket.on("message", (data) => listener(textOf(data))),
  onClose: (listener) => socket.on("close", (code) => listener(code)),
  onError: (listener) => socket.on("error", listener),
  onPing: (listener) => socket.on("ping", listener),
});

interface GlobalWebSocketLike {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  addEventListener: (type: string, listener: (event: never) => void) => void;
}

const wrapGlobal = (socket: GlobalWebSocketLike): SocketLike => ({
  send: (data) => socket.send(data),
  close: (code, reason) => socket.close(code, reason),
  terminate: () => socket.close(),
  onOpen: (listener) => socket.addEventListener("open", listener),
  onMessage: (listener) =>
    socket.addEventListener("message", (event: never) =>
      listener(textOf((event as { data: unknown }).data)),
    ),
  onClose: (listener) =>
    socket.addEventListener("close", (event: never) => listener((event as { code: number }).code)),
  onError: (listener) => socket.addEventListener("error", listener),
  onPing: () => {
    // The global WebSocket answers pings itself and does not report them.
  },
});

/** Opens a socket with `ws`, or with the global WebSocket when `ws` is not there. */
export const defaultSocketFactory: SocketFactory = ({ url, headers }) => {
  if (typeof WsWebSocket === "function") {
    return wrapWs(new WsWebSocket(url, { headers }));
  }
  const Global = (globalThis as unknown as { WebSocket?: new (url: string) => GlobalWebSocketLike })
    .WebSocket;
  if (typeof Global !== "function") throw new NoWebSocketError();
  return wrapGlobal(new Global(url));
};
