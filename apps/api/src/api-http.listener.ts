import { getRequestListener } from "@hono/node-server";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "@langwatch/observability";
import type { Hono } from "hono";

export type ApiListenerAddress = Readonly<{ host: string; port: number }>;

/**
 * A surface served straight off the Node server, ahead of the Hono
 * application.
 *
 * One surface needs this and it is not a preference: the hosted Model Context
 * Protocol endpoint is Streamable HTTP and Server-Sent Events over the raw
 * request and response objects, and its transports hold the socket for the
 * life of a session. Re-expressing it as fetch-style handlers would mean
 * rewriting the transports the MCP SDK owns.
 *
 * `handles` is asked first, with the pathname alone, so a surface that says no
 * costs one string comparison and everything else reaches Hono untouched.
 */
export abstract class ApiRawRequestSurfacePort {
  abstract handles(pathname: string): boolean;
  abstract handle(request: IncomingMessage, response: ServerResponse): void;
}

/**
 * A second `upgrade` listener on this process's own server (ADR-128): the
 * connected-agent WebSocket gateway is the only registrant today, routed by
 * pathname behind this port so the listener does not need to know it exists.
 */
export abstract class ApiUpgradeSurfacePort {
  abstract attach(server: Server): void;
}

export type ApiHttpListenerOptions = Readonly<{
  application: Hono;
  host?: string;
  port: number;
  drainGraceMs?: number;
  logger?: Pick<Logger, "error" | "info">;
  /** Served before the Hono application; see {@link ApiRawRequestSurfacePort}. */
  rawSurface?: ApiRawRequestSurfacePort | undefined;
  /** Attached to the server's own `upgrade` event; see {@link ApiUpgradeSurfacePort}. */
  upgrades?: ApiUpgradeSurfacePort | undefined;
}>;

/**
 * Owns the Node HTTP intake for the standalone API process.
 *
 * Closing first stops new connections, then gives live requests a bounded
 * grace before reaping the remaining sockets. Process resources are closed by
 * ApiProcess only after this listener resolves.
 */
export class ApiHttpListener {
  static create(options: ApiHttpListenerOptions): ApiHttpListener {
    return new ApiHttpListener(options);
  }

  private readonly server: Server;
  private started: Promise<ApiListenerAddress> | undefined;
  private closing: Promise<void> | undefined;

  private constructor(private readonly options: ApiHttpListenerOptions) {
    const listener = getRequestListener(options.application.fetch, {
      overrideGlobalObjects: false,
    });
    const rawSurface = options.rawSurface;
    this.server = createServer(
      rawSurface
        ? (request, response) => {
            // The pathname alone, because that is all the surface is asked
            // about. Parsing against a fixed base rather than the Host header
            // keeps a caller-supplied Host out of the routing decision.
            const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            if (rawSurface.handles(pathname)) {
              rawSurface.handle(request, response);
              return;
            }
            listener(request, response);
          }
        : listener,
    );
    this.server.on("error", (error) => {
      this.options.logger?.error({ error }, "API HTTP listener failed");
    });
    options.upgrades?.attach(this.server);
  }

  start(): Promise<ApiListenerAddress> {
    if (this.closing) {
      throw new Error("API HTTP listener is closing.");
    }

    this.started ??= this.listen();
    return this.started;
  }

  close(): Promise<void> {
    this.closing ??= this.drain();
    return this.closing;
  }

  private async listen(): Promise<ApiListenerAddress> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };

      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.options.port, this.options.host);
    });

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("API HTTP listener did not report a TCP address.");
    }

    const listening = { host: address.address, port: address.port };
    this.options.logger?.info(listening, "API HTTP listener started");
    return listening;
  }

  private async drain(): Promise<void> {
    if (!this.started) return;

    await this.started.catch(() => void 0);
    if (!this.server.listening) return;

    const closed = new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.server.closeIdleConnections();

    const drainGraceMs = this.options.drainGraceMs ?? 5_000;
    const drained = await Promise.race([
      closed.then(() => true),
      delay(drainGraceMs, false as const, { ref: false }),
    ]);
    if (!drained) {
      this.options.logger?.info(
        { drainGraceMs },
        "API requests outlived the drain grace, closing remaining connections",
      );
      this.server.closeAllConnections();
      await closed;
    }
  }
}
