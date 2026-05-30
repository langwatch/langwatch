/**
 * Integration coverage for the topic-clustering trace fetch against a real
 * ClickHouse.
 *
 * The pre-fix query read `ComputedInput` (a potentially large payload) for the
 * entire deduped 12-month trace set before `ORDER BY ... LIMIT 2000` trimmed
 * it, tipping busy tenants into MEMORY_LIMIT_EXCEEDED. The fix pages the 2000
 * most-recent trace keys first (lightweight columns only) and reads
 * `ComputedInput` for that bounded set alone.
 *
 * These tests exercise the real `fetchTracesFromClickHouse` and lock in the
 * behaviour that matters for correctness and pagination:
 *  - a full page returns the newest traces, newest first;
 *  - the cursor advances to strictly older, non-overlapping traces;
 *  - empty-input traces still occupy page slots so the cursor reaches older
 *    eligible traces instead of stalling (the heavy-column read stays bounded
 *    to the page either way — verified separately during development).
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wrapWithDefaultSettings } from "~/server/clickhouse/safeClickhouseClient";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { fetchTracesFromClickHouse } from "../topicClustering";

const TENANT_ID = "topic-fetch-test";
// A bit more than one page (2000) so a second page exists for the cursor test.
const N_TRACES = 3_000;

type TraceRow = Record<string, unknown>;

function traceRow(tenant: string, i: number, computedInput: string): TraceRow {
  const now = Date.now();
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    TraceId: `${tenant}-trace-${String(i).padStart(6, "0")}`,
    Version: "v1",
    Attributes: {},
    // Newest = lowest index.
    OccurredAt: new Date(now - i * 60_000),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now - i),
    ComputedIOSchemaVersion: "",
    ComputedInput: computedInput,
    ComputedOutput: "out",
    TimeToFirstTokenMs: 1,
    TimeToLastTokenMs: 1,
    TotalDurationMs: 1,
    TokensPerSecond: 1,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: ["gpt-5-mini"],
    TotalCost: 0.01,
    TokensEstimated: false,
    TotalPromptTokenCount: 1,
    TotalCompletionTokenCount: 1,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: i % 3 === 0 ? `topic-${i % 5}` : null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

async function insertRows(ch: ClickHouseClient, rows: TraceRow[]) {
  const BATCH = 2000;
  for (let i = 0; i < rows.length; i += BATCH) {
    await ch.insert({
      table: "trace_summaries",
      values: rows.slice(i, i + BATCH),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}

describe("fetchTracesFromClickHouse integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    const raw = getTestClickHouseClient();
    if (!raw) throw new Error("ClickHouse client not available");
    ch = wrapWithDefaultSettings(raw);
    const input = JSON.stringify("hello world");
    await insertRows(
      ch,
      Array.from({ length: N_TRACES }, (_, i) => traceRow(TENANT_ID, i, input)),
    );
  }, 120_000);

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  describe("when fetching a full batch", () => {
    it("returns the 2000 newest traces, newest first, all with input", async () => {
      const res = await fetchTracesFromClickHouse(ch, TENANT_ID, false, [], []);

      expect(res.traces).toHaveLength(2000);
      expect(res.returnedCount).toBe(2000);
      expect(res.traces.every((t) => t.input.length > 0)).toBe(true);
      expect(res.traces[0]?.trace_id).toBe(`${TENANT_ID}-trace-000000`);
      expect(res.lastSort).toBeDefined();
    });
  });

  describe("when the search cursor advances", () => {
    it("returns strictly older, non-overlapping traces", async () => {
      const first = await fetchTracesFromClickHouse(ch, TENANT_ID, false, [], []);
      const second = await fetchTracesFromClickHouse(
        ch,
        TENANT_ID,
        false,
        [],
        [],
        first.lastSort!,
      );

      expect(second.traces.length).toBeGreaterThan(0);
      const firstIds = new Set(first.traces.map((t) => t.trace_id));
      expect(second.traces.some((t) => firstIds.has(t.trace_id))).toBe(false);
    });
  });

  describe("when a full page of the newest traces has empty input", () => {
    // The page is selected by recency alone, so empty-input traces still
    // occupy page slots. With a *full* page (2000) of empty-input traces, the
    // older input-bearing traces sit beyond the page boundary and are only
    // reachable if the cursor advances by the page boundary rather than the
    // (here empty) filtered result. This is the cursor-stall regression
    // CodeRabbit flagged from when the empty filter lived in SQL.
    const EMPTY_TENANT = "topic-fetch-empty-test";
    const OLDER_WITH_INPUT = 20;

    beforeAll(async () => {
      const input = JSON.stringify("hello world");
      // 2000 newest traces have empty input; the next 20 (older) carry input.
      await insertRows(
        ch,
        Array.from({ length: 2000 + OLDER_WITH_INPUT }, (_, i) =>
          traceRow(EMPTY_TENANT, i, i < 2000 ? "" : input),
        ),
      );
    }, 120_000);

    afterAll(async () => {
      await cleanupTestData(EMPTY_TENANT);
    });

    it("advances the cursor past a full empty page to reach older traces", async () => {
      const page1 = await fetchTracesFromClickHouse(ch, EMPTY_TENANT, false, [], []);

      // Page 1 is a full page of empty-input traces: nothing to cluster, but
      // the cursor must still track the page boundary (the 2000th trace).
      expect(page1.traces).toHaveLength(0);
      expect(page1.returnedCount).toBe(2000);
      expect(page1.lastSort?.[1]).toBe(`${EMPTY_TENANT}-trace-001999`);

      // Page 2, seeked from that cursor, reaches the older input-bearing
      // traces that the pre-fix SQL filter would have stranded.
      const page2 = await fetchTracesFromClickHouse(
        ch,
        EMPTY_TENANT,
        false,
        [],
        [],
        page1.lastSort!,
      );
      expect(page2.traces).toHaveLength(OLDER_WITH_INPUT);
      expect(page2.traces.every((t) => t.input.length > 0)).toBe(true);
      expect(page2.traces[0]?.trace_id).toBe(`${EMPTY_TENANT}-trace-002000`);
    });
  });
});
