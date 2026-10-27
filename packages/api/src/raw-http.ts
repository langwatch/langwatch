import type { IncomingMessage, ServerResponse } from "node:http";

import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:api:raw-http-door");

/** A request handler over the raw Node request and response, as a listener calls it. */
export type RawHttpListener = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

/** One exchange handed on unrouted: the handler owns the response from here. */
export type RawHttpExchange = Readonly<{
  request: IncomingMessage;
  response: ServerResponse;
}>;

/** What a door opened over its module's application answers with, once per mount. */
export type RawHttpDoor = Readonly<{
  handle: (exchange: RawHttpExchange) => void | Promise<void>;
  /** Releases what the door holds open (live streams, sessions) at shutdown. */
  close: () => Promise<void>;
}>;

/**
 * Requests answered over the raw Node request and response, ahead of every
 * route (record §8): exact paths, and prefixes claiming a path and everything
 * beneath it. `open` runs once at mount, over the module's application.
 */
export class RawHttpProtocol<App> {
  readonly protocol = "rawhttp" as const;
  readonly paths: readonly string[];
  readonly prefixes: readonly string[];
  readonly #open: (app: App) => RawHttpDoor;

  static create<App>(options: {
    paths: readonly string[];
    prefixes: readonly string[];
    open: (app: App) => RawHttpDoor;
  }): RawHttpProtocol<App> {
    return new RawHttpProtocol(options);
  }

  private constructor(options: {
    paths: readonly string[];
    prefixes: readonly string[];
    open: (app: App) => RawHttpDoor;
  }) {
    this.paths = options.paths;
    this.prefixes = options.prefixes;
    this.#open = options.open;
  }

  /** The declaration as the installer reads a transport back. */
  router(): this {
    return this;
  }

  claims(pathname: string): boolean {
    return (
      this.paths.includes(pathname) ||
      this.prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    );
  }

  open(app: App): RawHttpDoor {
    return this.#open(app);
  }
}

type MountedDoor = Readonly<{
  protocol: RawHttpProtocol<unknown>;
  door: RawHttpDoor;
}>;

/**
 * The api process's raw HTTP doors: a request a door claims is answered by it
 * before the process's routes see it; every other request goes on unchanged.
 */
export class RawHttpHost {
  readonly #mounted: MountedDoor[] = [];

  static create(): RawHttpHost {
    return new RawHttpHost();
  }

  private constructor() {}

  mount(declaration: object, app: () => unknown): void {
    if (!(declaration instanceof RawHttpProtocol))
      throw new TypeError("A raw HTTP transport must be declared with RawHttpProtocol.create.");
    for (const claimed of [...declaration.paths, ...declaration.prefixes]) {
      if (this.#mounted.some(({ protocol }) => protocol.claims(claimed)))
        throw new Error(`Two raw HTTP doors claim "${claimed}".`);
    }
    this.#mounted.push({ protocol: declaration, door: declaration.open(app()) });
  }

  /** The process's handler with every mounted door answering ahead of it. */
  ahead(next: RawHttpListener): RawHttpListener {
    if (this.#mounted.length === 0) return next;
    return (request, response) => {
      const pathname = (request.url ?? "/").split("?")[0] ?? "/";
      const mounted = this.#mounted.find(({ protocol }) => protocol.claims(pathname));
      if (!mounted) return next(request, response);
      return this.#answer(mounted.door, { request, response });
    };
  }

  async close(): Promise<void> {
    const mounted = this.#mounted.splice(0);
    await Promise.all(mounted.map(({ door }) => door.close()));
  }

  async #answer(door: RawHttpDoor, exchange: RawHttpExchange): Promise<void> {
    try {
      await door.handle(exchange);
    } catch (error) {
      logger.error({ error, url: exchange.request.url }, "a raw HTTP door failed a request");
      if (!exchange.response.headersSent) exchange.response.writeHead(500).end();
    }
  }
}
