import type { LogRequestCollectionResult } from "@langwatch/log-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { OtlpIngestCredential, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { otlpLogAnswer } from "../../rules/otlp-log-answer.rules.ts";
import { OtlpLogReceiverService } from "../otlp-log-receiver.service.ts";

const LOG_BATCH = {
  resourceLogs: [
    {
      resource: { attributes: [] },
      scopeLogs: [
        {
          scope: { name: "app.logger" },
          logRecords: [{ timeUnixNano: "1700000000000000000", body: { stringValue: "hello" } }],
        },
      ],
    },
  ],
};

/** The key the `otlp_ingest` door verified before the body reached the receiver. */
const CREDENTIAL: OtlpIngestCredential = {
  project: { id: "project-1", teamId: "team-1", organizationId: "organization-1" },
  identity: {
    apiKeyId: "key-1",
    organizationId: "organization-1",
    ingestSourceType: null,
    ingestionTemplateId: null,
  },
};

function receiver({
  collected = { outcome: "collected", acceptedLogRecords: 1, rejectedLogRecords: 0 },
}: { collected?: LogRequestCollectionResult } = {}) {
  const calls: { markedUsed: string[]; collectedFor: string[] } = {
    markedUsed: [],
    collectedFor: [],
  };
  const traces = createApiFixture<TraceApi>({
    otlpUsageLimit: async () => {},
    otlpMarkCredentialUsed: ({ apiKeyId }) => void calls.markedUsed.push(apiKeyId),
  });
  const service = OtlpLogReceiverService.create({
    traces,
    collection: {
      handleOtlpLogRequest: async ({ tenantId }) => {
        calls.collectedFor.push(tenantId);
        return collected;
      },
    },
  });
  const post = async (path: string, body: string = JSON.stringify(LOG_BATCH)) =>
    otlpLogAnswer(
      await service.receive({
        request: {
          method: "POST",
          path,
          headers: { "content-type": "application/json" },
          body: new TextEncoder().encode(body),
        },
        credential: CREDENTIAL,
      }),
    );
  return { post, calls };
}

describe("OtlpLogReceiverService", () => {
  describe("given a key that resolves and a valid log batch", () => {
    it("collects the batch for the key's project and marks the key used", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/logs")).resolves.toEqual({ status: 200, body: {} });
      expect(calls).toEqual({ markedUsed: ["key-1"], collectedFor: ["project-1"] });
    });

    it("serves a logs suffix appended to a traces base as log ingestion", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/traces/v1/logs")).resolves.toEqual({ status: 200, body: {} });
      expect(calls.collectedFor).toEqual(["project-1"]);
    });

    it("names the records the collection rejected", async () => {
      const { post } = receiver({
        collected: {
          outcome: "collected",
          acceptedLogRecords: 1,
          rejectedLogRecords: 2,
          errorMessage: "log record 2: missing body",
        },
      });

      await expect(post("/api/otel/v1/logs")).resolves.toEqual({
        status: 200,
        body: {
          partialSuccess: { rejectedLogRecords: 2, errorMessage: "log record 2: missing body" },
        },
      });
    });
  });

  describe("given the platform cannot durably store the batch", () => {
    /** @scenario "Storage trouble asks the client to retry" */
    it("answers the retryable 503 without naming any record rejected", async () => {
      const { post } = receiver({
        collected: { outcome: "unavailable", errorMessage: "failed to record log record" },
      });

      await expect(post("/api/otel/v1/logs")).resolves.toEqual({
        status: 503,
        body: { error: "failed to record log record" },
      });
    });
  });

  describe("given a body that is not OTLP", () => {
    it("answers 400, reports no exception and leaves the key unmarked", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/logs", "{not json")).resolves.toEqual({
        status: 400,
        body: { error: "Failed to parse logs" },
      });
      expect(calls).toEqual({ markedUsed: [], collectedFor: [] });
    });
  });

  describe("given a path outside the known exporter misconfigurations", () => {
    it("answers 404 and collects nothing", async () => {
      const { post, calls } = receiver();

      await expect(post("/elsewhere/v1/logs")).resolves.toEqual({
        status: 404,
        body: { error: "Not Found" },
      });
      expect(calls.collectedFor).toEqual([]);
    });
  });
});
