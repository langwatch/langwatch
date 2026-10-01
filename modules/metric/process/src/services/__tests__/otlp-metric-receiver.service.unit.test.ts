import { ProjectMissingCredentialsError } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import type { MetricRequestCollectionResult } from "@langwatch/metric-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { otlpMetricAnswer } from "../../rules/otlp-metric-answer.rules.ts";
import { OtlpMetricReceiverService } from "../otlp-metric-receiver.service.ts";

const METRIC_BATCH = {
  resourceMetrics: [
    {
      resource: { attributes: [] },
      scopeMetrics: [
        {
          scope: { name: "app.meter" },
          metrics: [
            {
              name: "requests",
              sum: {
                aggregationTemporality: 2,
                isMonotonic: true,
                dataPoints: [{ timeUnixNano: "1700000000000000000", asInt: "12" }],
              },
            },
          ],
        },
      ],
    },
  ],
};

function receiver({
  collected = { outcome: "collected", acceptedDataPoints: 1, rejectedDataPoints: 0 },
  keyless = false,
}: { collected?: MetricRequestCollectionResult; keyless?: boolean } = {}) {
  const calls: { markedUsed: string[]; reported: number; collectedFor: string[] } = {
    markedUsed: [],
    reported: 0,
    collectedFor: [],
  };
  const traces = createApiFixture<TraceApi>({
    otlpCredential: async () => {
      if (keyless) throw new ProjectMissingCredentialsError();
      return {
        project: { id: "project-1", teamId: "team-1", organizationId: "organization-1" },
        identity: {
          apiKeyId: "key-1",
          organizationId: "organization-1",
          ingestSourceType: null,
          ingestionTemplateId: null,
        },
      };
    },
    otlpUsageLimit: async () => {},
    otlpMarkCredentialUsed: ({ apiKeyId }) => void calls.markedUsed.push(apiKeyId),
    otlpReportError: () => void calls.reported++,
  });
  const service = OtlpMetricReceiverService.create({
    traces,
    collection: {
      handleOtlpMetricRequest: async ({ tenantId }) => {
        calls.collectedFor.push(tenantId);
        return collected;
      },
    },
  });
  const post = async (path: string, body: string = JSON.stringify(METRIC_BATCH)) =>
    otlpMetricAnswer(
      await service.receive({
        method: "POST",
        path,
        headers: { "content-type": "application/json", "x-auth-token": "sk-lw-test" },
        body: new TextEncoder().encode(body),
      }),
    );
  return { post, calls };
}

describe("OtlpMetricReceiverService", () => {
  describe("given a key that resolves and a valid metric batch", () => {
    it("collects the batch for the key's project and marks the key used", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/metrics")).resolves.toEqual({ status: 200, body: {} });
      expect(calls).toEqual({ markedUsed: ["key-1"], reported: 0, collectedFor: ["project-1"] });
    });

    /** @scenario "A metrics suffix under a traces base is metric ingestion" */
    it("serves a metrics suffix appended to a traces base as metric ingestion", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/traces/v1/metrics")).resolves.toEqual({
        status: 200,
        body: {},
      });
      expect(calls.collectedFor).toEqual(["project-1"]);
    });

    it("names the points the collection rejected", async () => {
      const { post } = receiver({
        collected: {
          outcome: "collected",
          acceptedDataPoints: 1,
          rejectedDataPoints: 2,
          errorMessage: "data point 2: not finite",
        },
      });

      await expect(post("/api/otel/v1/metrics")).resolves.toEqual({
        status: 200,
        body: {
          partialSuccess: { rejectedDataPoints: 2, errorMessage: "data point 2: not finite" },
        },
      });
    });
  });

  describe("given the platform cannot durably store the batch", () => {
    /** @scenario "Storage trouble asks the client to retry the metric batch" */
    it("answers the retryable 503 without naming any point rejected", async () => {
      const { post } = receiver({
        collected: { outcome: "unavailable", errorMessage: "failed to record data point" },
      });

      await expect(post("/api/otel/v1/metrics")).resolves.toEqual({
        status: 503,
        body: { error: "failed to record data point" },
      });
    });
  });

  describe("given no credential", () => {
    it("refuses with the key directory's 401 and collects nothing", async () => {
      const { post, calls } = receiver({ keyless: true });

      const answer = await post("/api/otel/v1/traces/v1/metrics");

      expect(answer.status).toBe(401);
      expect(Object.keys(answer.body)).toEqual(["message"]);
      expect(calls.collectedFor).toEqual([]);
    });
  });

  describe("given a body that is not OTLP", () => {
    it("answers 400, reports the failure and leaves the key unmarked", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/metrics", "{not json")).resolves.toEqual({
        status: 400,
        body: { error: "Failed to parse metrics" },
      });
      expect(calls).toEqual({ markedUsed: [], reported: 1, collectedFor: [] });
    });
  });

  describe("given a path outside the known exporter misconfigurations", () => {
    it("answers 404 before touching the credential", async () => {
      const { post, calls } = receiver({ keyless: true });

      await expect(post("/elsewhere/v1/metrics")).resolves.toEqual({
        status: 404,
        body: { error: "Not Found" },
      });
      expect(calls.collectedFor).toEqual([]);
    });
  });
});
