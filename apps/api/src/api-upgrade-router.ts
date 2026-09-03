/**
 * One `upgrade` listener on the process's own HTTP server, routed by
 * pathname (ADR-128).
 *
 * The connected-agent gateway is the only registrant on this branch — tRPC
 * subscriptions ride `/api/sse` instead (commit 3aedccbb74) — but the router
 * stays path-routed so a second WebSocket door can register beside it. An
 * upgrade for a path nothing registered is answered 404 and the socket is
 * destroyed, so a mistyped path never hangs a client until the proxy times
 * out.
 */

import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { ConnectUpgradeRouterPort, UpgradeHandler } from "@langwatch/agent-server";
import { ApiUpgradeSurfacePort } from "./api-http.listener";

export class ApiUpgradeRouter extends ApiUpgradeSurfacePort implements ConnectUpgradeRouterPort {
  static create(): ApiUpgradeRouter {
    return new ApiUpgradeRouter();
  }

  private readonly handlers = new Map<string, UpgradeHandler>();

  register(pathname: string, handler: UpgradeHandler): void {
    if (this.handlers.has(pathname)) {
      throw new Error(`An upgrade handler is already registered for ${pathname}`);
    }
    this.handlers.set(pathname, handler);
  }

  attach(server: Server): void {
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const handler = this.handlers.get(pathname);
      if (!handler) {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      handler(request, socket, head);
    });
  }
}
