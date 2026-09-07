/**
 * @see specs/analytics/filter-value-validation.feature
 *
 * The reported symptom was numbers, not SQL: a timeseries asked for "traces
 * with an error" came back identical to the unfiltered one. Asserting on the
 * generated WHERE clause would not have caught that, because the clause the
 * old code generated (`1=1`) was valid SQL that ran fine. So this test seeds
 * real traces into `trace_summaries`, runs the real timeseries query against
 * a real ClickHouse, and compares the three counts a caller would compare.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTimeseriesQuery } from "~/server/analytics/clickhouse/aggregation-builder";
import { TraceSummaryClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-summary.clickhouse.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

const tenantId = `test-error-filter-${nanoid()}`;

// Minute-aligned "yesterday", never a fixed calendar date: rows are stamped
// with the platform's default retention and TTL-deleted that many days after
// OccurredAt, so a fixed date eventually ages out and the fixtures vanish.
const baseMs = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 60_000) * 60_000;

let ch: ClickHouseClient;
let summaryRepo: TraceSummaryClickHouseRepository;

function makeSummary(overrides: Partial<TraceSummaryData>): TraceSummaryData {
  return {
    traceId: `trace-${nanoid()}`,
    spanCount: 1,
    totalDurationMs: 100,
    computedIOSchemaVersion: "2026-04-28",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: 0,
    nonBilledCost: 0,
    tokensEstimated: false,
    totalPromptTokenCount: 0,
    totalCompletionTokenCount: 0,
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
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    traceName: "filter fixture",
    attributes: {},
    traceNameUserOverridden: false,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    occurredAt: baseMs,
    createdAt: baseMs,
    updatedAt: baseMs,
    LastEventOccurredAt: baseMs,
    ...overrides,
  };
}

const window = {
  startDate: new Date(baseMs - 60 * 60 * 1000),
  endDate: new Date(baseMs + 60 * 60 * 1000),
  previousPeriodStartDate: new Date(baseMs - 26 * 60 * 60 * 1000),
  timeScale: 1440 as const,
  timeZone: "UTC",
};

/** The trace count a caller would read off the chart, for these filters. */
async function traceCount(
  filters?: Parameters<typeof buildTimeseriesQuery>[0]["filters"],
): Promise<number> {
  const { sql, params } = buildTimeseriesQuery({
    projectId: tenantId,
    startDate: window.startDate,
    endDate: window.endDate,
    previousPeriodStartDate: window.previousPeriodStartDate,
    series: [
      { metric: "metadata.trace_id", aggregation: "cardinality" as const },
    ],
    filters,
    timeScale: window.timeScale,
    timeZone: window.timeZone,
  });
  const result = await ch.query({
    query: sql,
    query_params: params,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<Record<string, unknown>>;
  return rows
    .filter((row) => row.period === "current")
    .reduce(
      (total, row) =>
        total + Number(row["0__metadata_trace_id__cardinality"] ?? 0),
      0,
    );
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  summaryRepo = new TraceSummaryClickHouseRepository(async () => ch);

  await summaryRepo.upsertBatch([
    { data: makeSummary({ containsErrorStatus: true }), tenantId },
    { data: makeSummary({ containsErrorStatus: true }), tenantId },
    { data: makeSummary({ containsErrorStatus: false }), tenantId },
    { data: makeSummary({ containsErrorStatus: false }), tenantId },
    { data: makeSummary({ containsErrorStatus: false }), tenantId },
  ]);
  await ch.exec({ query: "SYSTEM FLUSH ASYNC INSERT QUEUE" });
  await ch.exec({ query: "SYSTEM FLUSH LOGS" });
}, 180_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("Feature: analytics rejects filter values it cannot apply", () => {
  describe("given two traces that contain an error and three that do not", () => {
    /** @scenario "A filtered timeseries query returns fewer traces than an unfiltered one" */
    it("counts only the traces that contain an error when filtered", async () => {
      const unfiltered = await traceCount();
      const withError = await traceCount({ "traces.error": ["true"] });
      const withoutError = await traceCount({ "traces.error": ["false"] });

      expect(unfiltered).toBe(5);
      expect(withError).toBe(2);
      expect(withoutError).toBe(3);
      // The regression itself: these three used to be the same number.
      expect(withError).not.toBe(unfiltered);
      expect(withError).not.toBe(withoutError);
    });

    it("counts every trace when both error states are asked for", async () => {
      expect(await traceCount({ "traces.error": ["true", "false"] })).toBe(5);
    });

    it("refuses an option label before running any query", async () => {
      await expect(
        traceCount({ "traces.error": ["Traces with error"] }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });
  });
});
