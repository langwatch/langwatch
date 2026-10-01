/**
 * @vitest-environment node
 * Which exporter addresses reach the metrics receiver.
 * @see specs/otlp/endpoint-path-canonicalisation.feature
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type { MetricApi } from "@langwatch/metric-contract";
import { describe, expect, it } from "vitest";

import { otlpMetricsRest } from "../otlp-metrics.rest.ts";

const unused = () => Promise.reject(new Error("not part of this door"));

function mount() {
  const received: string[] = [];
  const app: MetricApi = {
    prepareMetricDataPoints: unused,
    collectOtlpMetrics: unused,
    recordCanonicalMetricDataPoints: unused,
    receiveOtlpMetrics: async ({ path }) => {
      received.push(path);
      return { outcome: "collected", acceptedDataPoints: 0, rejectedDataPoints: 0 };
    },
  };
  const hono = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the receiver resolves its own credential");
      },
    },
  }).mount(otlpMetricsRest.router(), {
    app: () => app,
    credential: "public",
    onError: (error) => {
      throw error;
    },
  });

  const post = (path: string) =>
    hono.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceMetrics: [] }),
    });

  return { post, received };
}

describe("the OTLP metrics receiver's addresses", () => {
  describe("when an exporter posts with a doubled slash before the signal", () => {
    /** @scenario An endpoint with a doubled slash before the signal */
    it("serves it as metric ingestion, handing the receiver the path as sent", async () => {
      const { post, received } = mount();

      const response = await post("/api/otel/v1//metrics");

      expect(response.status).toBe(200);
      expect(received).toEqual(["/api/otel/v1//metrics"]);
    });
  });
});
