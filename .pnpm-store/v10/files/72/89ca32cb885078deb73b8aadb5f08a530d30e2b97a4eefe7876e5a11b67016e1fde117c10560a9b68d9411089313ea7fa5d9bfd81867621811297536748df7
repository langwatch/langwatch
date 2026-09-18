import { IncomingMessage, Server, ServerOptions, ServerResponse, createServer } from "node:http";
import { Http2SecureServer, Http2Server, Http2ServerRequest, Http2ServerResponse, SecureServerOptions, ServerOptions as ServerOptions$1, createSecureServer, createServer as createServer$1 } from "node:http2";
import { Duplex } from "node:stream";
import { UpgradeWebSocket } from "hono/ws";
import { AddressInfo } from "node:net";
import { ServerOptions as ServerOptions$2, createServer as createServer$2 } from "node:https";

//#region src/websocket-types.d.ts
type WSReadyState = 0 | 1 | 2 | 3;
type WebSocketData = string | ArrayBuffer | Uint8Array | readonly Uint8Array[];
type WebSocketSendOptions = {
  compress?: boolean;
};
interface WebSocketLike {
  protocol: string;
  readyState: WSReadyState;
  close(code?: number, reason?: string): void;
  send(data: string | ArrayBuffer | ArrayBufferView, options?: WebSocketSendOptions): void;
  on(event: 'message', listener: (data: WebSocketData, isBinary: boolean) => void): this;
  on(event: 'close', listener: (code: number, reason: Uint8Array) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  off(event: 'message', listener: (data: WebSocketData, isBinary: boolean) => void): this;
}
interface WebSocketServerLike {
  options: {
    noServer?: boolean;
  };
  on(event: 'connection', listener: (ws: WebSocketLike, request: IncomingMessage) => void): this;
  on(event: 'headers', listener: (headers: string[]) => void): this;
  off(event: 'headers', listener: (headers: string[]) => void): this;
  emit(event: 'connection', ws: WebSocketLike, request: IncomingMessage): boolean;
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (ws: WebSocketLike) => void): void;
  close(): void;
}
//#endregion
//#region src/types.d.ts
type HttpBindings = {
  incoming: IncomingMessage;
  outgoing: ServerResponse;
};
type Http2Bindings = {
  incoming: Http2ServerRequest;
  outgoing: Http2ServerResponse;
};
type FetchCallback = (request: Request, env: HttpBindings | Http2Bindings) => Promise<unknown> | unknown;
type ServerType = Server | Http2Server | Http2SecureServer;
type createHttpOptions = {
  serverOptions?: ServerOptions;
  createServer?: typeof createServer;
};
type createHttpsOptions = {
  serverOptions?: ServerOptions$2;
  createServer?: typeof createServer$2;
};
type createHttp2Options = {
  serverOptions?: ServerOptions$1;
  createServer?: typeof createServer$1;
};
type createSecureHttp2Options = {
  serverOptions?: SecureServerOptions;
  createServer?: typeof createSecureServer;
};
type ServerOptions$3 = createHttpOptions | createHttpsOptions | createHttp2Options | createSecureHttp2Options;
type Options = {
  fetch: FetchCallback;
  overrideGlobalObjects?: boolean;
  autoCleanupIncoming?: boolean;
  port?: number;
  hostname?: string;
  websocket?: {
    server: WebSocketServerLike;
  };
} & ServerOptions$3;
type CustomErrorHandler = (err: unknown) => void | Response | Promise<void | Response>;
//#endregion
//#region src/server.d.ts
declare const createAdaptorServer: (options: Options) => ServerType;
declare const serve: (options: Options, listeningListener?: (info: AddressInfo) => void) => ServerType;
//#endregion
//#region src/websocket.d.ts
type UpgradeWebSocketOptions = {
  onError: (err: unknown) => void;
};
declare const upgradeWebSocket: UpgradeWebSocket<WebSocketLike, UpgradeWebSocketOptions>;
//#endregion
//#region src/listener.d.ts
declare const getRequestListener: (fetchCallback: FetchCallback, options?: {
  hostname?: string;
  errorHandler?: CustomErrorHandler;
  overrideGlobalObjects?: boolean;
  autoCleanupIncoming?: boolean;
}) => (incoming: IncomingMessage | Http2ServerRequest, outgoing: ServerResponse | Http2ServerResponse) => Promise<void>;
//#endregion
//#region src/error.d.ts
declare class RequestError extends Error {
  constructor(message: string, options?: {
    cause?: unknown;
  });
}
//#endregion
export { type Http2Bindings, type HttpBindings, RequestError, type ServerType, type WebSocketData, type WebSocketLike, type WebSocketServerLike, createAdaptorServer, getRequestListener, serve, upgradeWebSocket };