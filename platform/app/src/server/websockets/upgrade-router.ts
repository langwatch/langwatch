/**
 * One `upgrade` listener on the HTTP server, routed by pathname.
 *
 * Several WebSocket endpoints share the app's listener: the tRPC transport
 * and the connected agent gateway today. Each registers its path here; an
 * upgrade for a path nothing registered is answered 404 and the socket is
 * destroyed, so a mistyped path never hangs a client until the proxy times
 * out.
 */

import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export type UpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

export interface UpgradeRouter {
  register(pathname: string, handler: UpgradeHandler): void;
}

export function createUpgradeRouter(server: HttpServer): UpgradeRouter {
  const handlers = new Map<string, UpgradeHandler>();

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const handler = handlers.get(pathname);
    if (!handler) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    handler(request, socket, head);
  });

  return {
    register(pathname, handler) {
      if (handlers.has(pathname)) {
        throw new Error(
          `An upgrade handler is already registered for ${pathname}`,
        );
      }
      handlers.set(pathname, handler);
    },
  };
}
