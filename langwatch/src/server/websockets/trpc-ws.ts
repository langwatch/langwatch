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
import { appRouter } from "../api/root";
import { createTRPCContext } from "../api/trpc";

const PATH = "/api/trpc-ws";

export function setupTRPCWebSocket(server: HttpServer): void {
  // `noServer: true` — we route by URL pathname so other future WS endpoints
  // can share the same HTTP server without their upgrades fighting.
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  applyWSSHandler({
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
}
