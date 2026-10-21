/**
 * The paged feedback query against the shipped schema: equal timestamps, several feedbacks in
 * one span and one trace, and a tenant fence, read to the end a page at a time.
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsFeedbackPosition } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

const TENANT_ID = "test-analytics-feedback-continuation";
const OTHER_TENANT_ID = "test-analytics-feedback-continuation-other";
const T0 = Math.floor((Date.now() - 60 * 60 * 1000) / 1000) * 1000;
const WINDOW = { startDate: T0 - 24 * 60 * 60 * 1000, endDate: T0 + 24 * 60 * 60 * 1000 };

const iso = (ms: number) => new Date(ms).toISOString();

/** One span's feedback events: a name and a timestamp each, every one carrying a vote. */
interface SeededSpan {
  tenantId: string;
  traceId: string;
  spanId: string;
  events: { name: string; at: number; vote: boolean }[];
}

const SPANS: SeededSpan[] = [
  {
    tenantId: TENANT_ID,
    traceId: "trace-a",
    spanId: "span-1",
    events: [
      { name: "thumbs_up_down", at: T0, vote: true },
      { name: "thumbs_up_down", at: T0, vote: true },
      { name: "thumbs_up_down", at: T0 - 1000, vote: true },
      { name: "exception", at: T0, vote: true },
      { name: "thumbs_up_down", at: T0, vote: false },
    ],
  },
  {
    tenantId: TENANT_ID,
    traceId: "trace-a",
    spanId: "span-2",
    events: [{ name: "thumbs_up_down", at: T0, vote: true }],
  },
  {
    tenantId: TENANT_ID,
    traceId: "trace-b",
    spanId: "span-1",
    events: [
      { name: "thumbs_up_down", at: T0, vote: true },
      { name: "thumbs_up_down", at: T0 - 5000, vote: true },
    ],
  },
  {
    tenantId: OTHER_TENANT_ID,
    traceId: "trace-x",
    spanId: "span-1",
    events: [{ name: "thumbs_up_down", at: T0 + 500, vote: true }],
  },
];

function traceSummaryRow(span: SeededSpan) {
  return {
    ProjectionId: `proj-${span.tenantId}-${span.traceId}`,
    TenantId: span.tenantId,
    TraceId: span.traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    Models: [],
  };
}

function storedSpanRow(span: SeededSpan) {
  return {
    ProjectionId: `proj-span-${span.tenantId}-${span.traceId}-${span.spanId}`,
    TenantId: span.tenantId,
    TraceId: span.traceId,
    SpanId: span.spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(T0 - 10_000),
    EndTime: new Date(T0),
    DurationMs: 10_000,
    SpanName: "feedback",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    "Events.Timestamp": span.events.map((event) => iso(event.at)),
    "Events.Name": span.events.map((event) => event.name),
    "Events.Attributes": span.events.map((event) =>
      event.vote ? { "event.metrics.vote": "1" } : { note: "no vote" },
    ),
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    Cost: null,
    NonBilledCost: null,
  };
}

describe("the paged feedback query on the shipped schema", () => {
  let ch: ClickHouseClient;
  let repository: ClickHouseAnalyticsRepository;

  const deleteRows = async () => {
    for (const tenantId of [TENANT_ID, OTHER_TENANT_ID]) {
      await deleteMigratedTenantRows({
        client: ch,
        tenantId,
        tables: ["trace_summaries", "stored_spans"],
      });
    }
  };

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
    repository = ClickHouseAnalyticsRepository.create({
      clickhouse: clickHouseQueryClientOver(ch),
    });
    await deleteRows();
    const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
    await ch.insert({
      table: "trace_summaries",
      values: SPANS.map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: settings,
    });
    await ch.insert({
      table: "stored_spans",
      values: SPANS.map(storedSpanRow),
      format: "JSONEachRow",
      clickhouse_settings: settings,
    });
  }, 60_000);

  afterAll(async () => {
    await deleteRows();
  });

  async function pagesOf({ limit }: { limit: number }): Promise<AnalyticsFeedbackPosition[][]> {
    const pages: AnalyticsFeedbackPosition[][] = [];
    let after: AnalyticsFeedbackPosition | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const read = await repository.findFeedbackEventsPage({
        authorization: analyticsProof({ projectId: TENANT_ID, permission: "cost:view" }),
        projectId: TENANT_ID,
        ...WINDOW,
        after,
        limit,
      });
      pages.push(read.rows.map((row) => row.position));
      if (!read.hasMore) return pages;
      after = read.rows.at(-1)?.position;
    }
    throw new Error("the history never ended");
  }

  describe("when read two at a time to the end", () => {
    /** @scenario "Following the cursors reads every feedback once, newest first" */
    it("lists every vote-carrying thumbs feedback once, newest first, of this tenant only", async () => {
      const pages = await pagesOf({ limit: 2 });

      expect(pages.flat()).toEqual([
        { startedAt: T0, traceId: "trace-b", spanId: "span-1", eventIndex: 1 },
        { startedAt: T0, traceId: "trace-a", spanId: "span-2", eventIndex: 1 },
        { startedAt: T0, traceId: "trace-a", spanId: "span-1", eventIndex: 2 },
        { startedAt: T0, traceId: "trace-a", spanId: "span-1", eventIndex: 1 },
        { startedAt: T0 - 1000, traceId: "trace-a", spanId: "span-1", eventIndex: 3 },
        { startedAt: T0 - 5000, traceId: "trace-b", spanId: "span-1", eventIndex: 2 },
      ]);
      expect(pages.map((page) => page.length)).toEqual([2, 2, 2]);
    });

    it("agrees with a single large page and with the existing unpaged read", async () => {
      const [onePage] = await pagesOf({ limit: 50 });
      const paged = (await pagesOf({ limit: 2 })).flat();
      const unpaged = await repository.findFeedbackEvents({
        authorization: analyticsProof({ projectId: TENANT_ID, permission: "cost:view" }),
        projectId: TENANT_ID,
        ...WINDOW,
      });

      expect(onePage).toEqual(paged);
      expect(unpaged.events.map((event) => event.event_id).toSorted()).toEqual(
        paged.map((position) => position.spanId).toSorted(),
      );
    });
  });

  describe("when the page holds exactly the whole history", () => {
    /** @scenario "A history that fits one page, or is empty, has no next page" */
    it("reports no further page", async () => {
      const read = await repository.findFeedbackEventsPage({
        authorization: analyticsProof({ projectId: TENANT_ID, permission: "cost:view" }),
        projectId: TENANT_ID,
        ...WINDOW,
        after: undefined,
        limit: 6,
      });

      expect(read.rows).toHaveLength(6);
      expect(read.hasMore).toBe(false);
    });

    it("reports an empty end for a window with no feedbacks", async () => {
      const read = await repository.findFeedbackEventsPage({
        authorization: analyticsProof({ projectId: TENANT_ID, permission: "cost:view" }),
        projectId: TENANT_ID,
        startDate: T0 - 400 * 24 * 60 * 60 * 1000,
        endDate: T0 - 399 * 24 * 60 * 60 * 1000,
        after: undefined,
        limit: 6,
      });

      expect(read).toEqual({ rows: [], hasMore: false });
    });
  });
});
