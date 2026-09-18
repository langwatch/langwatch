import type { IncomingMessage, ServerResponse } from "node:http";

import type { Logger } from "../logger.ts";

const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

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

async function emptyExposition(): Promise<PrometheusExposition> {
  return { body: "", contentType: PROMETHEUS_CONTENT_TYPE };
}
