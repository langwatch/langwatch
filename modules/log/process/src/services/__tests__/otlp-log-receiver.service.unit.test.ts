import { ProjectMissingCredentialsError } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import type { LogRequestCollectionResult } from "@langwatch/log-contract";
import type { TraceApi } from "@langwatch/trace-contract";
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

function receiver({
  collected = { outcome: "collected", acceptedLogRecords: 1, rejectedLogRecords: 0 },
  keyless = false,
}: { collected?: LogRequestCollectionResult; keyless?: boolean } = {}) {
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
        method: "POST",
        path,
        headers: { "content-type": "application/json", "x-auth-token": "sk-lw-test" },
        body: new TextEncoder().encode(body),
      }),
    );
  return { post, calls };
}

describe("OtlpLogReceiverService", () => {
  describe("given a key that resolves and a valid log batch", () => {
    it("collects the batch for the key's project and marks the key used", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/logs")).resolves.toEqual({ status: 200, body: {} });
      expect(calls).toEqual({ markedUsed: ["key-1"], reported: 0, collectedFor: ["project-1"] });
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

  describe("given no credential", () => {
    it("refuses with the key directory's 401 and collects nothing", async () => {
      const { post, calls } = receiver({ keyless: true });

      const answer = await post("/api/otel/v1/traces/v1/logs");

      expect(answer.status).toBe(401);
      expect(Object.keys(answer.body)).toEqual(["message"]);
      expect(calls.collectedFor).toEqual([]);
    });
  });

  describe("given a body that is not OTLP", () => {
    it("answers 400, reports the failure and leaves the key unmarked", async () => {
      const { post, calls } = receiver();

      await expect(post("/api/otel/v1/logs", "{not json")).resolves.toEqual({
        status: 400,
        body: { error: "Failed to parse logs" },
      });
      expect(calls).toEqual({ markedUsed: [], reported: 1, collectedFor: [] });
    });
  });

  describe("given a path outside the known exporter misconfigurations", () => {
    it("answers 404 before touching the credential", async () => {
      const { post, calls } = receiver({ keyless: true });

      await expect(post("/elsewhere/v1/logs")).resolves.toEqual({
        status: 404,
        body: { error: "Not Found" },
      });
      expect(calls.collectedFor).toEqual([]);
    });
  });
});
