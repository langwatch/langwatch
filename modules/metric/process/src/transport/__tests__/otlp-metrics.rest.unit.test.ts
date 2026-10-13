/**
 * @vitest-environment node
 * Which exporter addresses reach the metrics receiver.
 * @see specs/otlp/endpoint-path-canonicalisation.feature
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type { MetricApi } from "@langwatch/metric-contract";
import { stampCorrectedPath } from "@langwatch/observability";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { otlpMetricsDoor, otlpMetricsRest } from "../otlp-metrics.rest.ts";

const CREDENTIAL = {
  project: { id: "project-1", teamId: "team-1", organizationId: "organization-1" },
  identity: {
    apiKeyId: "key-1",
    organizationId: "organization-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
  },
};
const unused = () => Promise.reject(new Error("not part of this door"));

function mount() {
  const received: string[] = [];
  const app: MetricApi = {
    prepareMetricDataPoints: unused,
    collectOtlpMetrics: unused,
    recordCanonicalMetricDataPoints: unused,
    receiveOtlpMetrics: async ({ request }) => {
      received.push(request.path);
      return { outcome: "collected", acceptedDataPoints: 0, rejectedDataPoints: 0 };
    },
  };
  const hono = createRestRuntime({
    doors: {
      otlp_ingest: otlpMetricsDoor.open(
        createApiFixture<TraceApi>({ otlpCredential: async () => CREDENTIAL }),
      ),
    },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the receiver resolves its own credential");
      },
    },
  }).mount(otlpMetricsRest.router(), {
    app: () => app,
    credential: "otlp_ingest",
    onError: (error) => {
      throw error;
    },
  });

  const post = (path: string, headers: Headers = new Headers()) => {
    headers.set("content-type", "application/json");
    return hono.request(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ resourceMetrics: [] }),
    });
  };

  return { post, received };
}

describe("the OTLP metrics receiver's addresses", () => {
  describe("when the host rewrote a doubled slash before the signal onto the canonical route", () => {
    /** @scenario An endpoint with a doubled slash before the signal */
    it("serves it as metric ingestion, handing the receiver the path as sent", async () => {
      const { post, received } = mount();
      const headers = new Headers();
      stampCorrectedPath({ headers, originalPath: "/api/otel/v1//metrics" });

      const response = await post("/api/otel/v1/metrics", headers);

      expect(response.status).toBe(200);
      expect(received).toEqual(["/api/otel/v1//metrics"]);
    });
  });
});
