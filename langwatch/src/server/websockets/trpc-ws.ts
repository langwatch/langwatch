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

import type { IncomingMessage, Server as HttpServer } from "http";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger/server";
import { appRouter } from "../api/root";
import { createTRPCContext } from "../api/trpc";

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

function buildOriginAllowlist(): Set<string> | null {
  const raw = env.NEXTAUTH_URL ?? "";
  if (!raw) return null;
  try {
    return new Set([new URL(raw).origin]);
  } catch {
    return null;
  }
}

export function setupTRPCWebSocket(server: HttpServer): TRPCWebSocketHandle {
  // `noServer: true` — we route by URL pathname so other future WS endpoints
  // can share the same HTTP server without their upgrades fighting.
  const wss = new WebSocketServer({ noServer: true });
  const allowedOrigins = buildOriginAllowlist();

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== PATH) return;

    // Origin allowlist — cookie-based auth means we must enforce same-origin
    // on the upgrade. Otherwise a logged-in user on evil.com could open a
    // WS back to our origin and call procedures with their session.
    const origin = req.headers.origin;
    if (allowedOrigins && origin && !allowedOrigins.has(origin)) {
      logger.warn(
        { origin, path: url.pathname },
        "rejecting WS upgrade: origin not allowed",
      );
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const handler = applyWSSHandler({
    wss,
    router: appRouter,
    // The WS adapter's context-fn opts have `{ req: IncomingMessage, res: WebSocket }`.
    // Our `createTRPCContext` only reads `req.headers` (for the session cookie)
    // and stores `res` opaquely — both shapes are safe at runtime.
    createContext: (opts) =>
      createTRPCContext({
        req: opts.req as IncomingMessage as Parameters<
          typeof createTRPCContext
        >[0]["req"],
        res: opts.res as Parameters<typeof createTRPCContext>[0]["res"],
      }),
    keepAlive: {
      enabled: true,
      pingMs: 30_000,
      pongWaitMs: 5_000,
    },
  });

  return {
    wss,
    broadcastReconnectNotification: () => {
      handler.broadcastReconnectNotification();
    },
    close: () =>
      new Promise<void>((resolve) => {
        wss.close(() => resolve());
      }),
  };
}
