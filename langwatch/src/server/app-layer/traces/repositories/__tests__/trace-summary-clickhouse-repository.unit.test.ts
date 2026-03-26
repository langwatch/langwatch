import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { TraceSummaryClickHouseRepository } from "../trace-summary.clickhouse.repository";

function makeMockClient() {
  const insertFn = vi.fn().mockResolvedValue(undefined);
  const jsonFn = vi.fn().mockResolvedValue([]);
  const queryFn = vi.fn().mockResolvedValue({ json: jsonFn });
  return { client: { query: queryFn, insert: insertFn } as unknown as ClickHouseClient, queryFn, jsonFn, insertFn };
}

describe("TraceSummaryClickHouseRepository", () => {
  describe("getByTraceId()", () => {
    describe("when querying for a trace summary", () => {
      it("excludes ScenarioRole Map columns from SELECT to avoid OOM on old merged parts", async () => {
        const { client, queryFn } = makeMockClient();
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new TraceSummaryClickHouseRepository(resolver);

        await repo.getByTraceId("tenant-1", "trace-1");

        const query = queryFn.mock.calls[0]![0].query as string;
        expect(query).not.toContain("ScenarioRoleCosts");
        expect(query).not.toContain("ScenarioRoleLatencies");
        expect(query).not.toContain("ScenarioRoleSpans");
      });

      it("returns empty objects for scenarioRole fields", async () => {
        const { client, jsonFn } = makeMockClient();
        jsonFn.mockResolvedValue([
          {
            ProjectionId: "proj-1",
            TenantId: "tenant-1",
            TraceId: "trace-1",
            Version: "1",
            Attributes: {},
            OccurredAt: 1000,
            CreatedAt: 1000,
            UpdatedAt: 1000,
            ComputedIOSchemaVersion: "v1",
            ComputedInput: null,
            ComputedOutput: null,
            TimeToFirstTokenMs: null,
            TimeToLastTokenMs: null,
            TotalDurationMs: 100,
            TokensPerSecond: null,
            SpanCount: 1,
            ContainsErrorStatus: 0,
            ContainsOKStatus: 1,
            ErrorMessage: null,
            Models: [],
            TotalCost: null,
            TokensEstimated: false,
            TotalPromptTokenCount: null,
            TotalCompletionTokenCount: null,
            OutputFromRootSpan: 1,
            OutputSpanEndTimeMs: 1100,
            BlockedByGuardrail: 0,
            TopicId: null,
            SubTopicId: null,
            HasAnnotation: null,
          },
        ]);
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new TraceSummaryClickHouseRepository(resolver);

        const result = await repo.getByTraceId("tenant-1", "trace-1");

        expect(result).not.toBeNull();
        expect(result!.scenarioRoleCosts).toEqual({});
        expect(result!.scenarioRoleLatencies).toEqual({});
        expect(result!.scenarioRoleSpans).toEqual({});
      });
    });
  });

  describe("upsert()", () => {
    describe("when writing a trace summary", () => {
      it("includes ScenarioRole Map columns in the insert values", async () => {
        const { client, insertFn } = makeMockClient();
        const resolver = vi.fn().mockResolvedValue(client);
        const repo = new TraceSummaryClickHouseRepository(resolver);

        await repo.upsert(
          {
            traceId: "trace-1",
            spanCount: 1,
            totalDurationMs: 100,
            computedIOSchemaVersion: "v1",
            computedInput: null,
            computedOutput: null,
            timeToFirstTokenMs: null,
            timeToLastTokenMs: null,
            tokensPerSecond: null,
            containsErrorStatus: false,
            containsOKStatus: true,
            errorMessage: null,
            models: [],
            totalCost: null,
            tokensEstimated: false,
            totalPromptTokenCount: null,
            totalCompletionTokenCount: null,
            outputFromRootSpan: true,
            outputSpanEndTimeMs: 1100,
            blockedByGuardrail: false,
            topicId: null,
            subTopicId: null,
            hasAnnotation: null,
            attributes: {},
            scenarioRoleCosts: { agent: 0.05 },
            scenarioRoleLatencies: { agent: 200 },
            scenarioRoleSpans: { agent: "span-1" },
            occurredAt: 1000,
            createdAt: 1000,
            updatedAt: 1000,
          },
          "tenant-1",
        );

        const insertedValues = insertFn.mock.calls[0]![0].values[0];
        expect(insertedValues.ScenarioRoleCosts).toEqual({ agent: 0.05 });
        expect(insertedValues.ScenarioRoleLatencies).toEqual({ agent: 200 });
        expect(insertedValues.ScenarioRoleSpans).toEqual({ agent: "span-1" });
      });
    });
  });
});
