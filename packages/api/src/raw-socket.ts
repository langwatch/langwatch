import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:api:raw-socket-door");

/** The liveness path the door answers on its own port, so a probe needs no route. */
export const RAW_SOCKET_LIVENESS_PATH = "/healthz";

/** One upgrade handed on unopened: the handler owns the socket from here. */
export type RawSocketUpgrade = Readonly<{
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  /** The values the declared path pattern captured, by name. */
  params: Readonly<Record<string, string>>;
}>;

/**
 * A socket that must be handed on unopened (record §8): a path pattern such as
 * `/twilio/:nonce` and a handler given the request, the raw socket and `head`.
 */
export class RawSocketProtocol<App> {
  readonly protocol = "rawsocket" as const;
  readonly #pattern: RegExp;
  readonly #names: readonly string[];
  readonly #handle: (app: App, upgrade: RawSocketUpgrade) => void;

  static create<App>(options: {
    path: string;
    handle: (app: App, upgrade: RawSocketUpgrade) => void;
  }): RawSocketProtocol<App> {
    return new RawSocketProtocol(options);
  }

  private constructor(options: {
    path: string;
    handle: (app: App, upgrade: RawSocketUpgrade) => void;
  }) {
    const names: string[] = [];
    const source = options.path
      .split("/")
      .map((segment) => {
        if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(segment.slice(1));
        return "([^/]+)";
      })
      .join("/");
    this.#pattern = new RegExp(`^${source}$`);
    this.#names = names;
    this.#handle = options.handle;
  }

  /** The declaration as the installer reads a transport back. */
  router(): this {
    return this;
  }

  /** The captured params when the pathname matches this pattern, else nothing. */
  match(pathname: string): Readonly<Record<string, string>> | undefined {
    const matched = this.#pattern.exec(pathname);
    if (!matched) return undefined;
    return Object.fromEntries(this.#names.map((name, index) => [name, matched[index + 1] ?? ""]));
  }

  handle(app: App, upgrade: RawSocketUpgrade): void {
    this.#handle(app, upgrade);
  }
}

type MountedProtocol = Readonly<{
  protocol: RawSocketProtocol<unknown>;
  app: () => unknown;
}>;

/**
 * The role's own port for raw-socket doors: `/healthz` 200, other requests 404, an
 * unmatched upgrade closed 404. An unbindable port is logged and left closed, so
 * one door never takes the role's other work down with it.
 */
export class RawSocketHost {
  readonly #port: number;
  readonly #mounted: MountedProtocol[] = [];
  #server: Server | undefined;

  static create(options: { port: number }): RawSocketHost {
    return new RawSocketHost(options.port);
  }

  private constructor(port: number) {
    this.#port = port;
  }

  mount(declaration: object, app: () => unknown): void {
    if (!(declaration instanceof RawSocketProtocol))
      throw new TypeError("A raw socket transport must be declared with RawSocketProtocol.create.");
    this.#mounted.push({ protocol: declaration, app });
  }

  /** Whether any installed module declared a door, so a role with none binds no port. */
  get isEmpty(): boolean {
    return this.#mounted.length === 0;
  }

  async listen(): Promise<AddressInfo | undefined> {
    if (this.isEmpty || this.#server) return addressOf(this.#server);
    const server = createServer((request, response) => this.#answer(request, response));
    server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) =>
      this.#upgrade(request, socket, head),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.#port, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    } catch (error) {
      logger.error({ error, port: this.#port }, "raw socket door could not bind its port");
      return undefined;
    }
    this.#server = server;
    return addressOf(server);
  }

  async close(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    this.#server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  #answer(request: IncomingMessage, response: ServerResponse): void {
    if (request.url === RAW_SOCKET_LIVENESS_PATH) {
      response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
  }

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? "/", "http://raw-socket.local").pathname;
    for (const { protocol, app } of this.#mounted) {
      const params = protocol.match(pathname);
      if (params) {
        protocol.handle(app(), { request, socket, head, params });
        return;
      }
    }
    socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
  }
}

function addressOf(server: Server | undefined): AddressInfo | undefined {
  const address = server?.address();
  return typeof address === "object" && address !== null ? address : undefined;
}
