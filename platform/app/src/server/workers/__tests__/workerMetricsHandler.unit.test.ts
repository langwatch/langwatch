/**
 * @vitest-environment node
 *
 * Covers the worker metrics server's routing + auth branches — the handler the
 * kubelet's liveness/startup probes call.
 *
 * The regression that motivates the liveness path: the Helm chart probed
 * `GET /metrics`, but that endpoint is fail-closed in production (no
 * METRICS_API_KEY ⇒ 500) and an httpGet probe cannot read a Secret, so both a
 * default install and a secretKeyRef install crash-looped. `/healthz` answers
 * unauthenticated in every configuration; `/metrics` keeps its bearer gate.
 *
 * See specs/server/worker-liveness-probe.feature.
 */

import { Counter, register } from "prom-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createWorkerMetricsHandler, WORKER_LIVENESS_PATH } from "../startWorkers";

// Derive the fakes' types from the handler itself, so this test cannot drift
// from the @types/node signature the real listener is checked against.
type Handler = ReturnType<typeof createWorkerMetricsHandler>;
type HandlerRequest = Parameters<Handler>[0];
type HandlerResponse = Parameters<Handler>[1];

/**
 * Captures what the handler wrote, without binding a port.
 *
 * Headers are captured from BOTH paths the handler uses — `writeHead(status,
 * headers)` for the liveness reply and `setHeader(name, value)` for the metrics
 * reply. A fake that drops them (a no-op `setHeader`, a `writeHead` that reads
 * only its first argument) lets the Content-Type line be deleted from the
 * handler with every test still green, while Prometheus silently stops parsing
 * the worker registry.
 */
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

/**
 * Name of the fixture metric the "serves the registry" test registers. Removed
 * in afterEach rather than at the end of the test body, so a failing assertion
 * cannot leave it behind in the process-wide prom-client registry.
 */
const PROBE_METRIC = "worker_metrics_handler_probe_total";

/** Drains the handler's floating `register.metrics()` promise chain. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("createWorkerMetricsHandler", () => {
  afterEach(() => {
    register.removeSingleMetric(PROBE_METRIC);
  });

  describe("given the liveness path", () => {
    describe("when the metrics gate would throw (production, no API key)", () => {
      /** @scenario Default install — no metrics API key in production */
      it("answers 200 without consulting the gate", async () => {
        // The default-install case: this is exactly the configuration that
        // made a /metrics probe crash-loop every stock worker deployment.
        const gate = vi.fn(() => {
          throw new Error("METRICS_API_KEY is not set");
        });
        const { req, res, captured } = fakeExchange(WORKER_LIVENESS_PATH);

        createWorkerMetricsHandler(gate)(req, res);
        await flush();

        expect(captured.status).toBe(200);
        expect(gate).not.toHaveBeenCalled();
      });
    });

    describe("when the request carries no credentials", () => {
      /** @scenario Key configured, probe still sends nothing */
      it("answers 200 even though the gate would reject", async () => {
        // The secretKeyRef case: the key exists in the container's env, but no
        // rendered httpGet header can ever carry it.
        const gate = vi.fn(() => false);
        const { req, res, captured } = fakeExchange(WORKER_LIVENESS_PATH);

        createWorkerMetricsHandler(gate)(req, res);
        await flush();

        expect(captured.status).toBe(200);
        expect(gate).not.toHaveBeenCalled();
      });
    });

    describe("when the probe reads the response body", () => {
      /** @scenario The liveness endpoint leaks no telemetry */
      it("answers ok as plain text, with no metric samples", async () => {
        const { req, res, captured } = fakeExchange(WORKER_LIVENESS_PATH);

        createWorkerMetricsHandler(() => true)(req, res);
        await flush();

        expect(captured.body).toBe("ok");
        expect(captured.headers["content-type"]).toBe("text/plain");
      });
    });
  });

  describe("given the metrics path", () => {
    describe("when the gate rejects the caller", () => {
      /** @scenario Metrics still require the bearer when a key is set */
      it("answers 401", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler(() => false)(req, res);
        await flush();

        expect(captured.status).toBe(401);
      });
    });

    describe("when the gate throws (production, no API key)", () => {
      /** @scenario Metrics still fail closed in production without a key */
      it("fails closed with 500", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler(() => {
          throw new Error("METRICS_API_KEY is not set");
        })(req, res);
        await flush();

        expect(captured.status).toBe(500);
      });
    });

    describe("when the gate accepts the caller", () => {
      /** @scenario Metrics are served to a correctly authenticated caller */
      it("serves the registry with the Prometheus content type", async () => {
        // Register a sample so the body is non-empty in this process. Without
        // one the registry renders "" and any "did it serve?" assertion passes
        // on the empty string.
        const probe = new Counter({
          name: PROBE_METRIC,
          help: "Fixture counter proving the registry is rendered.",
          registers: [register],
        });
        probe.inc();

        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler(() => true)(req, res);
        await flush();

        // Neither auth branch fired. Assert the outcome a scraper observes, not
        // which Node code path produced it: the success path currently writes no
        // explicit status and relies on the implicit 200, but an explicit
        // writeHead(200) is equally correct and must not turn this red.
        expect(captured.status ?? 200).toBe(200);
        // Prometheus needs this exact content type to parse the response; the
        // handler sets it via setHeader, so the fake must capture it.
        expect(captured.headers["content-type"]).toBe(register.contentType);
        expect(captured.body).toContain(PROBE_METRIC);
      });
    });
  });

  describe("given an unknown path", () => {
    describe("when any caller requests it", () => {
      /** @scenario An unrelated path is not served */
      it("answers 404", async () => {
        const { req, res, captured } = fakeExchange("/not-a-real-path");

        createWorkerMetricsHandler(() => true)(req, res);
        await flush();

        expect(captured.status).toBe(404);
      });
    });
  });
});
