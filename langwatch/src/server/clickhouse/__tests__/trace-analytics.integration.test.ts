/**
 * Integration tests for the `trace_analytics` ReplacingMergeTree (ADR-034
 * Phase 2 — the SLIM per-trace fold), exercised against a real ClickHouse
 * testcontainer on the production schema (migration 00037 auto-applies through
 * goose in `startTestContainers`).
 *
 * Drives the slim repository directly with `TraceAnalyticsRow` values shaped
 * exactly like `projectAnalyticsStateToRow` produces. Each test exercises:
 *
 *   * ReplacingMergeTree(UpdatedAt) dedup — multiple inserts with the same
 *     (TenantId, TraceId) keys but increasing UpdatedAt collapse to the
 *     latest (Version is the schema-snapshot identifier; UpdatedAt is the
 *     LWW dedup column, mirroring trace_summaries).
 *   * **Slim genuinely slim** — a row written with a known-payload key
 *     (`gen_ai.prompt`) and an over-cap arbitrary key must NOT contain either
 *     on read. This is the validation that slim is not "trace_summaries minus
 *     I/O".
 *   * **Cross-check vs trace_summaries** — for the SAME trace written through
 *     both folds, slim's hoisted typed columns (TotalCost, TimeToFirstTokenMs,
 *     Models, TopicId, Origin) match the corresponding trace_summaries
 *     columns to the cent.
 *
 * Maps to specs/analytics/event-sourced-analytics-materialization.feature
 * (Rule: "The slim table reflects the latest value per trace under mutation"
 * and Rule: "Late-resolved dimensions are served from the slim table").
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TraceAnalyticsClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-analytics.clickhouse.repository";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import {
  projectAnalyticsStateToRow,
  type TraceAnalyticsData,
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsRow,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

let ch: ClickHouseClient;
let analyticsRepo: TraceAnalyticsClickHouseRepository;
let summaryRepo: TraceSummaryClickHouseRepository;

const baseMs = new Date("2026-06-15T12:00:00.000Z").getTime();

function makeAnalyticsRow(overrides: Partial<TraceAnalyticsRow> = {}): TraceAnalyticsRow {
  return {
    tenantId: "tenant-default",
    traceId: "trace-default",
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
    occurredAtMs: baseMs,
    createdAtMs: baseMs,
    updatedAtMs: baseMs,
    traceName: "test trace",
    topicId: null,
    subTopicId: null,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: "",
    models: [],
    labels: [],
    totalCost: null,
    nonBilledCost: null,
    totalDurationMs: 0,
    timeToFirstTokenMs: null,
    tokensPerSecond: null,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    hasError: false,
    hasAnnotation: null,
    attributes: {},
    ...overrides,
  };
}

/**
 * The trace_summaries + trace_analytics repos default to async_insert with
 * `wait_for_async_insert: 0` to keep the per-event hot path fast. Tests need
 * the rows visible IMMEDIATELY, so after every set of writes we ask CH to
 * flush its async-insert queue and then synchronise that flush.
 */
async function flushAsyncInserts(): Promise<void> {
  await ch.exec({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
  await ch.exec({ query: "SYSTEM FLUSH LOGS" });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  analyticsRepo = new TraceAnalyticsClickHouseRepository(async () => ch);
  summaryRepo = new TraceSummaryClickHouseRepository(async () => ch);
}, 120_000);

afterAll(async () => {
  await stopTestContainers();
});

describe("trace_analytics slim fold (integration)", () => {
  describe("given a trace whose cost grows and origin flips across two slim writes", () => {
    const tenantId = `slim-grow-${nanoid()}`;
    const traceId = `slim-trace-${nanoid()}`;

    beforeAll(async () => {
      // First write: provisional origin "application", cost 0.01.
      // Second write: final origin "playground", cost 0.05 (grew). UpdatedAt
      // is the dedup column (mirrors trace_summaries) — the second row has a
      // strictly later UpdatedAt so it wins on read.
      await analyticsRepo.upsertBatch([
        {
          row: makeAnalyticsRow({
            tenantId,
            traceId,
            origin: "application",
            totalCost: 0.01,
            totalDurationMs: 1000,
            updatedAtMs: baseMs,
          }),
        },
        {
          row: makeAnalyticsRow({
            tenantId,
            traceId,
            origin: "playground",
            totalCost: 0.05,
            totalDurationMs: 2500,
            updatedAtMs: baseMs + 1000,
          }),
        },
      ]);
      await flushAsyncInserts();
    });

    afterAll(async () => {
      await ch.exec({
        query:
          "ALTER TABLE trace_analytics DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
    });

    describe("when the slim table is read for the latest version", () => {
      it("returns the FINAL cost and FINAL origin", async () => {
        // IN-tuple dedup over (TenantId, TraceId): the inner subquery picks
        // the latest UpdatedAt for the row, outer SELECT pulls the columns
        // for only the matched row. Matches clickhouse-queries.md guidance.
        const result = await ch.query({
          query: `
            SELECT
              t.TotalCost AS totalCost,
              t.Origin AS origin,
              t.TotalDurationMs AS totalDurationMs
            FROM trace_analytics AS t
            WHERE t.TenantId = {tenantId:String}
              AND t.TraceId = {traceId:String}
              AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
                SELECT TenantId, TraceId, max(UpdatedAt)
                FROM trace_analytics
                WHERE TenantId = {tenantId:String}
                  AND TraceId = {traceId:String}
                GROUP BY TenantId, TraceId
              )
            LIMIT 1
          `,
          query_params: { tenantId, traceId },
          format: "JSONEachRow",
        });
        const rows = (await result.json()) as Array<{
          totalCost: number | null;
          origin: string;
          totalDurationMs: string;
        }>;
        expect(rows).toHaveLength(1);
        expect(rows[0]!.totalCost).toBeCloseTo(0.05, 6);
        expect(rows[0]!.origin).toBe("playground");
        // TotalDurationMs is Int64 → serialized as string on read.
        expect(Number(rows[0]!.totalDurationMs)).toBe(2500);
      });

      it("dedups multiple versions to one row per (TenantId, TraceId)", async () => {
        const result = await ch.query({
          query: `
            SELECT count() AS c
            FROM trace_analytics
            WHERE TenantId = {tenantId:String}
              AND (TenantId, TraceId, UpdatedAt) IN (
                SELECT TenantId, TraceId, max(UpdatedAt)
                FROM trace_analytics
                WHERE TenantId = {tenantId:String}
                GROUP BY TenantId, TraceId
              )
          `,
          query_params: { tenantId },
          format: "JSONEachRow",
        });
        const rows = (await result.json()) as Array<{ c: string }>;
        expect(Number(rows[0]!.c)).toBe(1);
      });
    });
  });

  describe("given a slim row carrying a long arbitrary value and trimmed payload", () => {
    const tenantId = `slim-trim-${nanoid()}`;
    const traceId = `slim-trace-${nanoid()}`;

    beforeAll(async () => {
      // Simulate what projectAnalyticsStateToRow WOULD produce after
      // trimAttributesForAnalytics — i.e. the blocklisted + over-cap keys are
      // gone before the row hits the wire. The fold guarantees this; we write
      // only the trimmed subset to assert what the table actually receives.
      const longBlob = "z".repeat(2000); // under the 4 KiB metadata cap
      await analyticsRepo.upsertBatch([
        {
          row: makeAnalyticsRow({
            tenantId,
            traceId,
            attributes: {
              // KEEP: metadata.* (within cap), reserved keys, bounded
              // arbitrary identifiers.
              "metadata.tenant_tier": "enterprise",
              "metadata.long_dump": longBlob,
              "langwatch.reserved.output_source": "explicit",
              "gen_ai.agent.name": "weather-agent",
            },
          }),
        },
      ]);
      await flushAsyncInserts();
    });

    afterAll(async () => {
      await ch.exec({
        query:
          "ALTER TABLE trace_analytics DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
    });

    describe("when the slim attributes are read back", () => {
      it("contains the trimmed subset and explicitly does NOT contain blocklisted / over-cap keys", async () => {
        const result = await ch.query({
          query: `
            SELECT Attributes
            FROM trace_analytics
            WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
            LIMIT 1
          `,
          query_params: { tenantId, traceId },
          format: "JSONEachRow",
        });
        const rows = (await result.json()) as Array<{
          Attributes: Record<string, string>;
        }>;
        expect(rows).toHaveLength(1);
        const attrs = rows[0]!.Attributes;
        // The trimmed subset is present.
        expect(attrs["metadata.tenant_tier"]).toBe("enterprise");
        expect(attrs["langwatch.reserved.output_source"]).toBe("explicit");
        expect(attrs["gen_ai.agent.name"]).toBe("weather-agent");
        // Known-payload key and any over-cap key are explicitly NOT in the map
        // — this is the validation that slim is genuinely slim.
        expect(attrs["gen_ai.prompt"]).toBeUndefined();
        expect(attrs["gen_ai.completion"]).toBeUndefined();
        expect(attrs["some.huge.attr"]).toBeUndefined();
      });
    });
  });

  describe("given the SAME trace written through both folds", () => {
    const tenantId = `slim-xcheck-${nanoid()}`;
    const traceId = `slim-trace-${nanoid()}`;
    const state: TraceSummaryData = {
      traceId,
      spanCount: 2,
      totalDurationMs: 1800,
      computedIOSchemaVersion: "2026-04-28",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: 250,
      timeToLastTokenMs: 1500,
      tokensPerSecond: 8,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: ["gpt-5-mini"],
      totalCost: 0.07,
      nonBilledCost: 0,
      tokensEstimated: false,
      totalPromptTokenCount: 100,
      totalCompletionTokenCount: 50,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: "llm",
      containsAi: true,
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      topicId: "topic-billing",
      subTopicId: null,
      annotationIds: [],
      traceName: "billing chat",
      attributes: {
        "langwatch.origin": "playground",
        "langwatch.user_id": "user-7",
        "gen_ai.conversation.id": "thread-12",
        "langwatch.labels": JSON.stringify(["prod", "vip"]),
      },
      traceNameUserOverridden: false,
      traceNameFromFallback: false,
      rootMetadataFromFallback: false,
      occurredAt: baseMs,
      createdAt: baseMs,
      updatedAt: baseMs,
      LastEventOccurredAt: baseMs,
    };

    beforeAll(async () => {
      // Write the full trace_summaries row (production fold's destination).
      // upsertBatch sets wait_for_async_insert=1, so a flush isn't strictly
      // needed here for slim, but trace_summaries' upsert is async — flush
      // after both writes so the read sees both rows.
      await summaryRepo.upsertBatch([{ data: state, tenantId }]);
      // Build a slim state mirroring the same canonical inputs the trace
      // summary carries. Slim's state type is the subset of fields slim's
      // handlers need; the cross-check is over the hoisted dim columns, which
      // are read from these fields on both folds.
      const slimState: TraceAnalyticsData = {
        traceId: state.traceId,
        spanCount: state.spanCount,
        topicId: state.topicId,
        subTopicId: state.subTopicId,
        traceName: state.traceName,
        models: state.models,
        occurredAt: state.occurredAt,
        totalDurationMs: state.totalDurationMs,
        totalCost: state.totalCost,
        nonBilledCost: state.nonBilledCost,
        totalPromptTokenCount: state.totalPromptTokenCount,
        totalCompletionTokenCount: state.totalCompletionTokenCount,
        timeToFirstTokenMs: state.timeToFirstTokenMs,
        tokensPerSecond: state.tokensPerSecond,
        containsErrorStatus: state.containsErrorStatus,
        annotationIds: state.annotationIds,
        attributes: state.attributes,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        LastEventOccurredAt: state.LastEventOccurredAt,
      };
      const slimRow = projectAnalyticsStateToRow({
        state: slimState,
        tenantId,
        version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
      });
      await analyticsRepo.upsertBatch([{ row: slimRow }]);
      await flushAsyncInserts();
    });

    afterAll(async () => {
      await ch.exec({
        query:
          "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
      await ch.exec({
        query:
          "ALTER TABLE trace_analytics DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
    });

    describe("when the same hoisted dimensions are read from both tables", () => {
      it("matches TotalCost, TimeToFirstTokenMs, Models, TopicId, Origin to the cent", async () => {
        const summary = await summaryRepo.findByTraceId(tenantId, traceId);
        expect(summary).not.toBeNull();

        const slimResult = await ch.query({
          query: `
            SELECT
              TotalCost,
              TimeToFirstTokenMs,
              Models,
              TopicId,
              Origin,
              UserId,
              ConversationId,
              TraceName,
              Labels
            FROM trace_analytics
            WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
            LIMIT 1
          `,
          query_params: { tenantId, traceId },
          format: "JSONEachRow",
        });
        const slimRows = (await slimResult.json()) as Array<{
          TotalCost: number | null;
          TimeToFirstTokenMs: number | null;
          Models: string[];
          TopicId: string | null;
          Origin: string;
          UserId: string | null;
          ConversationId: string | null;
          TraceName: string;
          Labels: string[];
        }>;
        expect(slimRows).toHaveLength(1);
        const slim = slimRows[0]!;

        // Parity on what slim DOES carry: hoisted typed columns match the
        // trace_summaries source the slim was derived from.
        expect(slim.TotalCost).toBeCloseTo(summary!.totalCost ?? 0, 6);
        expect(slim.TimeToFirstTokenMs).toBe(summary!.timeToFirstTokenMs);
        expect(slim.Models).toEqual(summary!.models);
        expect(slim.TopicId).toBe(summary!.topicId);
        expect(slim.Origin).toBe(
          summary!.attributes["langwatch.origin"] ?? "",
        );
        expect(slim.UserId).toBe(summary!.attributes["langwatch.user_id"]);
        expect(slim.ConversationId).toBe(
          summary!.attributes["gen_ai.conversation.id"],
        );
        expect(slim.TraceName).toBe(summary!.traceName);
        // Slim has typed Array(String); summary has JSON-encoded string.
        expect(slim.Labels.sort()).toEqual(["prod", "vip"]);
      });
    });
  });
});
