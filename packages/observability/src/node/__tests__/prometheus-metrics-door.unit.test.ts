import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { prometheusMetrics } from "../prometheus-metrics-door.ts";

const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

let activeServer: http.Server | undefined;

afterEach(async () => {
  if (activeServer === undefined) return;
  await new Promise<void>((resolve) => activeServer?.close(() => resolve()));
  activeServer = undefined;
});

async function serve(route: ReturnType<typeof prometheusMetrics>) {
  const server = http.createServer((request, response) => {
    void route.handle(request, response);
  });
  activeServer = server;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return (path: string, authorization?: string) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: authorization === undefined ? {} : { authorization },
    });
}

describe("prometheusMetrics", () => {
  describe("given a configured token", () => {
    describe("when a scrape carries the matching bearer", () => {
      /** @scenario "A caller with the matching bearer token is served" */
      it("serves the exposition readMetrics returns", async () => {
        const readMetrics = vi.fn(async () => ({
          body: "worker_jobs_total 3\n",
          contentType: PROMETHEUS_CONTENT_TYPE,
        }));
        const request = await serve(prometheusMetrics({ token: "secret", readMetrics }));

        const response = await request("/metrics", "Bearer secret");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(PROMETHEUS_CONTENT_TYPE);
        await expect(response.text()).resolves.toBe("worker_jobs_total 3\n");
      });
    });

    describe("when a scrape carries no bearer", () => {
      /** @scenario "A caller without the token is refused" */
      it("refuses with 401", async () => {
        const request = await serve(prometheusMetrics({ token: "secret" }));

        const response = await request("/metrics");

        expect(response.status).toBe(401);
      });
    });
  });

  describe("given no token is configured", () => {
    describe("when readMetrics is not supplied", () => {
      /** @scenario "No token configured serves an empty exposition by default" */
      it("serves a valid empty exposition for a process exporting via OTLP instead", async () => {
        const request = await serve(prometheusMetrics());

        const response = await request("/metrics");

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe(PROMETHEUS_CONTENT_TYPE);
        await expect(response.text()).resolves.toBe("");
      });
    });
  });

  describe("given readMetrics rejects", () => {
    describe("when it is scraped", () => {
      it("answers 500 and logs the failure", async () => {
        const logger = { error: vi.fn() };
        const readMetrics = vi.fn(async () => {
          throw new Error("collection failed");
        });
        const request = await serve(prometheusMetrics({ readMetrics, logger }));

        const response = await request("/metrics");

        expect(response.status).toBe(500);
        expect(logger.error).toHaveBeenCalledOnce();
      });
    });
  });
});
