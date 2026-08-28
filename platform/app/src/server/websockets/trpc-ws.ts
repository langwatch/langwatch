/**
 * Bind the tRPC AppRouter to a WebSocket transport.
 *
 * Why: high-frequency client→server traffic (most notably the presence
 * cursor channel) was firing one HTTP POST per frame. With the browser's
 * 6 connection-per-origin HTTP/1.1 cap, those POSTs queued behind every
 * other request and dragged the UI down. A single long-lived WS per tab
 * collapses that into one connection and fuses each frame into one
 * `ws.send`. Auth, types, and rbac all flow through the same tRPC
 * pipeline as HTTP — there's no parallel auth path or DTO drift.
 *
 * Both transports are mounted simultaneously: the same procedure can be
 * called over either one. The client decides per-call (via `wsLink` +
 * `splitLink`) which procedures ride which transport.
 */

import { createLogger } from "@langwatch/observability";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import type { Server as HttpServer, IncomingMessage } from "http";
import type { Duplex } from "stream";
import { WebSocketServer } from "ws";
import { appRouter } from "../api/root";
import { createTRPCContext } from "../api/trpc";
import type { App } from "../app-layer/app";
import type { TrpcWebSocketRuntimeConfig } from "./trpc-ws.config";

const PATH = "/api/trpc-ws";
const logger = createLogger("langwatch:server:websockets:trpc-ws");

export interface TRPCWebSocketHandle {
  wss: WebSocketServer;
  /**
   * Politely tell connected clients to reconnect (tRPC's staggered
   * reconnect path) before the underlying socket is torn down.
   */
  broadcastReconnectNotification: () => void;
  /** Close the WebSocket server. Resolves when shutdown is complete. */
  close: () => Promise<void>;
}

/**
 * Process-owned tRPC WebSocket transport. It receives the resolved origin
 * policy so the socket layer never reads executable configuration itself.
 */
export class TrpcWebSocketRuntime {
  static create(input: {
    server: HttpServer;
    app: App;
    config: TrpcWebSocketRuntimeConfig;
  }): TrpcWebSocketRuntime {
    return new TrpcWebSocketRuntime(input.server, input.app, input.config);
  }

  private constructor(
    private readonly server: HttpServer,
    private readonly app: App,
    private readonly config: TrpcWebSocketRuntimeConfig,
  ) {}

  start(): TRPCWebSocketHandle {
    const { server, app } = this;
    // `noServer: true` — we route by URL pathname so other future WS endpoints
    // can share the same HTTP server without their upgrades fighting.
    const wss = new WebSocketServer({ noServer: true });
    const allowedOrigins =
      this.config.allowedOrigins.length > 0 ? new Set(this.config.allowedOrigins) : null;

    if (!allowedOrigins) {
      // Fail-closed: cookie-based auth across origins is a CSRF vector. If we
      // can't resolve an allowlist (NEXTAUTH_URL missing or malformed) we
      // refuse all upgrades rather than silently accept everything.
      logger.error(
        "WS origin allowlist could not be built (NEXTAUTH_URL missing or invalid); all WS upgrades will be rejected",
      );
    }

    const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== PATH) return;

      // Origin allowlist — cookie-based auth means we must enforce same-origin
      // on the upgrade. Otherwise a logged-in user on evil.com could open a
      // WS back to our origin and call procedures with their session. We
      // fail-closed: missing allowlist OR missing/unknown Origin → 403.
      const origin = req.headers.origin;
      if (!allowedOrigins || !origin || !allowedOrigins.has(origin)) {
        logger.warn(
          {
            origin: origin ?? null,
            hasAllowlist: !!allowedOrigins,
            path: url.pathname,
          },
          "rejecting WS upgrade: origin not allowed",
        );
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    };
    server.on("upgrade", handleUpgrade);

    const handler = applyWSSHandler({
      wss,
      router: appRouter,
      // The WS adapter's context-fn opts have `{ req: IncomingMessage, res: WebSocket }`.
      // Our `createTRPCContext` only reads `req.headers` (for the session cookie)
      // and stores `res` opaquely — both shapes are safe at runtime.
      createContext: (opts) =>
        createTRPCContext({
          req: opts.req as IncomingMessage as Parameters<typeof createTRPCContext>[0]["req"],
          res: opts.res as Parameters<typeof createTRPCContext>[0]["res"],
          app,
        }),
    });

    return {
      wss,
      broadcastReconnectNotification: () => {
        handler.broadcastReconnectNotification();
      },
      close: () =>
        new Promise<void>((resolve) => {
          server.off("upgrade", handleUpgrade);
          wss.close(() => resolve());
        }),
    };
  }
}
