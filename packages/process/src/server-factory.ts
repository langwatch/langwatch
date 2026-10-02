import { ServerPreamble } from "./preamble.ts";
import { Server as ServerBoundary, type ServerOptions } from "./server.ts";

export type {
  ApplicationHandler,
  HealthRoute,
  ServedApplication,
  ServerComponent,
  ServerContribution,
  ServerLogger,
  ServerOptions,
} from "./server.ts";

export class Server extends ServerBoundary {
  static create(name: string): ServerPreamble;
  static create(options: ServerOptions): ServerBoundary;
  static create(value: string | ServerOptions): ServerPreamble | ServerBoundary {
    if (typeof value === "string") return ServerPreamble.create(value);
    return ServerBoundary.create(value);
  }
}
