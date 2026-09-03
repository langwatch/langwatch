import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

/**
 * One `upgrade` listener shared by every WebSocket door of the process
 * (ADR-128). The gateway registers its path; the process owns the HTTP
 * server the upgrade rides on.
 */
export type UpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

export abstract class ConnectUpgradeRouterPort {
  abstract register(pathname: string, handler: UpgradeHandler): void;
}
