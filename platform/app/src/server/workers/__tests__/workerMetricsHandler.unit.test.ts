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
import { describe, expect, it, vi } from "vitest";

import {
  createWorkerMetricsHandler,
  WORKER_LIVENESS_PATH,
} from "../startWorkers";

// Derive the fakes' types from the handler itself, so this test cannot drift
// from the @types/node signature the real listener is checked against.
type Handler = ReturnType<typeof createWorkerMetricsHandler>;
type HandlerRequest = Parameters<Handler>[0];
type HandlerResponse = Parameters<Handler>[1];

/** Captures what the handler wrote, without binding a port. */
function fakeExchange(url: string) {
  const req = { url, headers: {} } as unknown as HandlerRequest;
  const captured: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return this;
    },
    setHeader() {
      return this;
    },
    end(body?: string) {
      captured.body = body;
      return this;
    },
  } as unknown as HandlerResponse;
  return { req, res, captured };
}

/** Drains the handler's floating `register.metrics()` promise chain. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("createWorkerMetricsHandler", () => {
  describe("given the liveness path", () => {
    describe("when the metrics gate would throw (production, no API key)", () => {
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

    it("returns no metric samples", async () => {
      const { req, res, captured } = fakeExchange(WORKER_LIVENESS_PATH);

      createWorkerMetricsHandler(() => true)(req, res);
      await flush();

      expect(captured.body).toBe("ok");
      expect(captured.body).not.toContain("#");
    });
  });

  describe("given the metrics path", () => {
    describe("when the gate rejects the caller", () => {
      it("answers 401", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler(() => false)(req, res);
        await flush();

        expect(captured.status).toBe(401);
      });
    });

    describe("when the gate throws (production, no API key)", () => {
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
      it("serves the registry rather than an auth failure", async () => {
        const { req, res, captured } = fakeExchange("/metrics");

        createWorkerMetricsHandler(() => true)(req, res);
        await flush();

        // Success writes no explicit status (Node defaults to 200); what
        // matters is that neither auth branch fired.
        expect(captured.status).toBeUndefined();
        expect(typeof captured.body).toBe("string");
      });
    });
  });

  describe("given an unknown path", () => {
    it("answers 404", async () => {
      const { req, res, captured } = fakeExchange("/not-a-real-path");

      createWorkerMetricsHandler(() => true)(req, res);
      await flush();

      expect(captured.status).toBe(404);
    });
  });
});
