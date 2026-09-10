import { getRequestListener } from "@hono/node-server";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "@langwatch/observability";
import type { Hono } from "hono";

export type ApiListenerAddress = Readonly<{ host: string; port: number }>;

const DEFAULT_DRAIN_GRACE_MS = 5_000;

/** Room inside the phase for the teardown either side of the grace. */
const CLOSE_PHASE_SLACK_MS = 2_000;

/**
 * A surface served straight off the Node server, ahead of the Hono app —
 * needed for the hosted MCP endpoint (SSE holds the socket for the
 * session's life). `handles` is asked first so a "no" costs one compare.
 */
export abstract class ApiRawRequestSurface {
  abstract handles(pathname: string): boolean;
  abstract handle(request: IncomingMessage, response: ServerResponse): void;
}

/**
 * A second `upgrade` listener on this process's own server (ADR-128): the
 * connected-agent WebSocket gateway is the only registrant today, routed by
 * pathname behind this port so the listener does not need to know it exists.
 */
export abstract class ApiUpgradeSurface {
  abstract attach(server: Server): void;
}

export type ApiHttpListenerOptions = Readonly<{
  application: Hono;
  host?: string;
  port: number;
  drainGraceMs?: number;
  logger?: Pick<Logger, "error" | "info">;
  /**
   * Teardown that must run once the listener stops accepting, and that must
   * not be paid for out of the grace in-flight requests were given. The hosted
   * Model Context Protocol sessions are the live registrant.
   */
  closeSessions?: (() => Promise<void>) | undefined;
  /** Served before the Hono application; see {@link ApiRawRequestSurface}. */
  rawSurface?: ApiRawRequestSurface | undefined;
  /** Attached to the server's own `upgrade` event; see {@link ApiUpgradeSurface}. */
  upgrades?: ApiUpgradeSurface | undefined;
}>;

/**
 * Owns the Node HTTP intake for the standalone API process. Closing stops
 * new connections, gives live requests a bounded grace, then reaps sockets.
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

  /**
   * The ceiling a shutdown runner may put on this phase. Strictly above the
   * grace, or the runner abandons the phase before the destroy the grace leads
   * into, and the sockets survive to the process deadline instead.
   */
  get closePhaseTimeoutMs(): number {
    return (this.options.drainGraceMs ?? DEFAULT_DRAIN_GRACE_MS) + CLOSE_PHASE_SLACK_MS;
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

    const drainGraceMs = this.options.drainGraceMs ?? DEFAULT_DRAIN_GRACE_MS;
    // The grace starts here, not after the session teardown below: it measures
    // how long in-flight requests have been given, and anything awaited before
    // it silently eats into that budget.
    const graceExpired = delay(drainGraceMs, false as const, { ref: false });
    // Session teardown must not decide whether sockets get reaped. A failure is
    // reported and stepped over: the listener is already closed, and leaving
    // the sockets alive until the process deadline is the worse outcome.
    try {
      await this.options.closeSessions?.();
    } catch (error) {
      this.options.logger?.error(
        { error },
        "API session teardown failed during shutdown, draining connections anyway",
      );
    }
    const drained = await Promise.race([closed.then(() => true), graceExpired]);
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
