import http, { type IncomingMessage, type ServerResponse } from "node:http";

import type { Logger } from "../logger.ts";

export const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

export type PrometheusExposition = Readonly<{
  body: string;
  contentType: string;
}>;

export type PrometheusMetricsOptions = Readonly<{
  /** Absent leaves the scrape open — the convenience `Server.healthAddress` needs in dev. */
  token?: string;
  /** Absent serves a valid empty exposition, for a process that exports via OTLP instead. */
  readMetrics?: () => Promise<PrometheusExposition>;
  logger?: Pick<Logger, "error">;
}>;

/**
 * The Prometheus scrape door, as a route this server's built-in health door
 * hosts — `Server.with(prometheusMetrics({ token }))`. Shaped so an
 * OTel-export variant can sit beside it later without any `main.ts` changing.
 */
export function prometheusMetrics(options: PrometheusMetricsOptions = {}): {
  path: string;
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
} {
  const readMetrics = options.readMetrics ?? emptyExposition;
  return {
    path: "/metrics",
    handle: async (request, response) => {
      const expected = options.token === undefined ? undefined : `Bearer ${options.token}`;
      if (expected !== undefined && request.headers.authorization !== expected) {
        response.writeHead(401).end();
        return;
      }
      try {
        const { body, contentType } = await readMetrics();
        response.writeHead(200, { "Content-Type": contentType }).end(body);
      } catch (error) {
        options.logger?.error({ error }, "prometheus metrics collection failed");
        response.writeHead(500).end();
      }
    },
  };
}

/**
 * The pull door on a listener of its own (ADR-175), never the public port:
 * the scrape route above answers on `host:port`, and nothing else does.
 */
export function prometheusPullListener({
  route,
  host,
  port,
}: {
  route: ReturnType<typeof prometheusMetrics>;
  host: string | undefined;
  port: number;
}): Readonly<{ name: string; start: () => Promise<void>; stop: () => Promise<void> }> {
  const listener = http.createServer((request, response) => {
    if (request.url?.split("?")[0] === route.path) void route.handle(request, response);
    else response.writeHead(404).end();
  });
  return {
    name: "prometheus pull door",
    start: () =>
      new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen({ port, ...(host === undefined ? {} : { host }) }, () => resolve());
      }),
    stop: () =>
      new Promise((resolve) => {
        listener.close(() => resolve());
        listener.closeAllConnections();
      }),
  };
}

async function emptyExposition(): Promise<PrometheusExposition> {
  return { body: "", contentType: PROMETHEUS_CONTENT_TYPE };
}
