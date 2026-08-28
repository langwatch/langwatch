import { getRequestListener } from "@hono/node-server";
import { createServer, type Server } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "@langwatch/observability";
import type { Hono } from "hono";

export type ApiListenerAddress = Readonly<{ host: string; port: number }>;

export type ApiHttpListenerOptions = Readonly<{
  application: Hono;
  host?: string;
  port: number;
  drainGraceMs?: number;
  logger?: Pick<Logger, "error" | "info">;
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
    this.server = createServer(listener);
    this.server.on("error", (error) => {
      this.options.logger?.error({ error }, "API HTTP listener failed");
    });
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
