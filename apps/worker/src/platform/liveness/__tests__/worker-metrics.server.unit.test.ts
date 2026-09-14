/**
 * @vitest-environment node
 *
 * Tests worker metrics server routing and auth for kubelet probes. /healthz is unauthenticated
 * (fixes crash-loop from fail-closed /metrics); /metrics keeps bearer auth.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkerMetricsHandler, type WorkerMetricsMembers } from "../worker-metrics.server.ts";
import { WORKER_LIVENESS_PATH } from "../worker.liveness.ts";

// Derive the fakes' types from the handler itself, so this test cannot drift
// from the @types/node signature the real listener is checked against.
type Handler = ReturnType<typeof createWorkerMetricsHandler>;
type HandlerRequest = Parameters<Handler>[0];
type HandlerResponse = Parameters<Handler>[1];

/** What a real prom-client registry hands back, standing in for one here. */
const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
const SAMPLES = "worker_metrics_handler_probe_total 1\n";

const servesSamples = vi.fn<WorkerMetricsMembers["readMetrics"]>(async () => ({
  body: SAMPLES,
  contentType: PROMETHEUS_CONTENT_TYPE,
}));

/** Fake that captures handler output without binding a port, verifying headers are properly set. */
function fakeExchange(url: string) {
  const req = { url, headers: {} } as unknown as HandlerRequest;
  const captured: {
    status?: number;
    body?: string;
    headers: Record<string, string>;
  } = { headers: {} };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      for (const [name, value] of Object.entries(headers ?? {})) {
        captured.headers[name.toLowerCase()] = value;
      }
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = value;
      return this;
    },
    end(body?: string) {
      captured.body = body;
      return this;
    },
  } as unknown as HandlerResponse;
  return { req, res, captured };
}

/** Drains the handler's floating `readMetrics()` promise chain. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("createWorkerMetricsHandler", () => {
  afterEach(() => {
    servesSamples.mockClear();
  });

  describe("given the liveness path", () => {
    describe("when the metrics gate would throw (production, no API key)", () => {
      /** @scenario Default install — no metrics API key in production */
      it("answers 200 without consulting the gate", async () => {
        // The default-install case: this is exactly the configuration that
        // made a /metrics probe crash-loop every stock worker deployment.
        const isAuthorized = vi.fn<WorkerMetricsMembers["isAuthorized"]>(() => {
          throw new Error("metrics API key is not set");
        });
        const { req, res, captured } = fakeExchange(WORKER_LIVENESS_PATH);

        createWorkerMetricsHandler({ isAuthorized, readMetrics: servesSamples })(req, res);
        await flush();

        expect(captured.status).toBe(200);
        expect(isAuthorized).not.toHaveBeenCalled();
      });
    });

    describe("when the request carries no credentials", () => {
      /** @scenario Key configured, probe still sends nothing */
      it("answers 200 even though the gate would reject", async () => {
        // The secretKeyRef case: the key exists in the container's env, but no
        // rendered httpGet header can ever carry it.
        const isAuthorized = vi.fn<WorkerMetricsMembers["isAuthorized"]>(() => false);
        const { req, res, captured } = fakeExchange(WORKER_LIVENESS_PATH);

        createWorkerMetricsHandler({ isAuthorized, readMetrics: servesSamples })(req, res);
        await flush();

        expect(captured.status).toBe(200);
        expect(isAuthorized).not.toHaveBeenCalled();
      });
    });

    describe("when the probe reads the response body", () => {
      /** @scenario The liveness endpoint leaks no telemetry */
      it("answers ok as plain text, with no metric samples", async () => {
        const { req, res, captured } = fakeExchange(WORKER_LIVENESS_PATH);

        createWorkerMetricsHandler({
          isAuthorized: () => true,
          readMetrics: servesSamples,
        })(req, res);
        await flush();

        expect(captured.body).toBe("ok");
        expect(captured.headers["content-type"]).toBe("text/plain");
        // The registry is never even read on this path, so no sample can leak.
        expect(servesSamples).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the metrics path", () => {
    describe("when the gate rejects the caller", () => {
      /** @scenario Metrics still require the bearer when a key is set */
      it("answers 401", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler({
          isAuthorized: () => false,
          readMetrics: servesSamples,
        })(req, res);
        await flush();

        expect(captured.status).toBe(401);
        expect(servesSamples).not.toHaveBeenCalled();
      });
    });

    describe("when the gate throws (production, no API key)", () => {
      /** @scenario Metrics still fail closed in production without a key */
      it("fails closed with 500", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler({
          isAuthorized: () => {
            throw new Error("metrics API key is not set");
          },
          readMetrics: servesSamples,
        })(req, res);
        await flush();

        expect(captured.status).toBe(500);
        expect(servesSamples).not.toHaveBeenCalled();
      });
    });

    describe("when the gate accepts the caller", () => {
      /** @scenario Metrics are served to a correctly authenticated caller */
      it("serves the registry with the Prometheus content type", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler({
          isAuthorized: () => true,
          readMetrics: servesSamples,
        })(req, res);
        await flush();

        expect(captured.status).toBe(200);
        // Prometheus needs the registry's own content type to parse the
        // response; the handler must pass it through untouched.
        expect(captured.headers["content-type"]).toBe(PROMETHEUS_CONTENT_TYPE);
        expect(captured.body).toBe(SAMPLES);
      });
    });

    describe("when reading the registry fails", () => {
      it("answers 500 rather than an empty scrape", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler({
          isAuthorized: () => true,
          readMetrics: async () => {
            throw new Error("registry unavailable");
          },
        })(req, res);
        await flush();

        expect(captured.status).toBe(500);
      });
    });
  });

  describe("given an unknown path", () => {
    describe("when any caller requests it", () => {
      /** @scenario An unrelated path is not served */
      it("answers 404", async () => {
        const { req, res, captured } = fakeExchange("/not-a-real-path");

        createWorkerMetricsHandler({
          isAuthorized: () => true,
          readMetrics: servesSamples,
        })(req, res);
        await flush();

        expect(captured.status).toBe(404);
        expect(servesSamples).not.toHaveBeenCalled();
      });
    });
  });
});
