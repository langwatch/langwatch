import { randomUUID } from "node:crypto";

/**
 * An aggregate's cost-gated reads (top documents, feedbacks and their pages) read its members
 * inside their grants' windows under the route's `cost:view` proof, and never a project outside
 * the proof (ADR-177 v4.15).
 * @see specs/governance/aggregate-project.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

const RUN = randomUUID();
const AGGREGATE = `test-agg-cost-${RUN}`;
const WHOLE_HISTORY_MEMBER = `test-agg-cost-a-${RUN}`;
const LATE_MEMBER = `test-agg-cost-b-${RUN}`;
const FOREIGN = `test-agg-cost-foreign-${RUN}`;
const SEEDED_TABLES = ["trace_summaries", "stored_spans"] as const;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const dateOf = (time: string) => new Date(at(time).epochMilliseconds);
const LATE_MEMBER_FROM = at("10:00:00");

/** One trace per row; its name is the document it cites and the feedback span it carries. */
const TRACES: { tenantId: string; time: string; name: string }[] = [
  { tenantId: WHOLE_HISTORY_MEMBER, time: "08:00:00", name: "a-early" },
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:00:00", name: "a-late" },
  { tenantId: LATE_MEMBER, time: "09:30:00", name: "b-before-grant" },
  { tenantId: LATE_MEMBER, time: "10:30:00", name: "b-in-grant" },
  { tenantId: FOREIGN, time: "10:30:00", name: "foreign" },
];
const IN_WINDOWS = ["a-early", "a-late", "b-in-grant"];

let client: ClickHouseClient;
let repository: ClickHouseAnalyticsRepository;

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;

function traceSummaryRow({ tenantId, time }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    Version: "v1",
    Attributes: {},
    OccurredAt: dateOf(time),
    CreatedAt: dateOf(time),
    UpdatedAt: dateOf(time),
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

function storedSpanRow({ tenantId, time, name }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-span-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    SpanId: name,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: dateOf(time),
    EndTime: dateOf(time),
    DurationMs: 1,
    SpanName: "rag",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {
      "langwatch.rag.contexts": JSON.stringify([{ document_id: name, content: name }]),
    },
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    "Events.Timestamp": [dateOf(time).toISOString()],
    "Events.Name": ["thumbs_up_down"],
    "Events.Attributes": [{ "event.metrics.vote": "1" }],
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

/** Member A shared for its whole history, member B only from its grant's start. */
const read = (projectId = AGGREGATE) => ({
  authorization: analyticsProof({
    projectId,
    permission: "cost:view",
    shared:
      projectId === AGGREGATE
        ? [
            { projectId: WHOLE_HISTORY_MEMBER, from: 0 },
            { projectId: LATE_MEMBER, from: LATE_MEMBER_FROM.epochMilliseconds },
          ]
        : [],
  }),
  projectId,
  startDate: at("06:00:00").epochMilliseconds,
  endDate: at("14:00:00").epochMilliseconds,
  filters: {},
});

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  repository = ClickHouseAnalyticsRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  await client.insert({
    table: "trace_summaries",
    values: TRACES.map(traceSummaryRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await client.insert({
    table: "stored_spans",
    values: TRACES.map(storedSpanRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 300_000);

afterAll(async () => {
  for (const tenantId of [AGGREGATE, WHOLE_HISTORY_MEMBER, LATE_MEMBER, FOREIGN]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: SEEDED_TABLES });
  }
});

describe("cost-gated reads under an aggregate's proof", () => {
  describe("given one member shared for its whole history and one from a later start", () => {
    /** @scenario "The aggregate's top documents and feedbacks read members inside their windows" */
    it("ranks documents cited by the members inside their windows, never a foreign one", async () => {
      const result = await repository.findTopDocuments(read());

      expect(result.topDocuments.map((doc) => doc.documentId).toSorted()).toEqual(IN_WINDOWS);
      expect(result.totalUniqueDocuments).toBe(IN_WINDOWS.length);
    });

    /** @scenario "The aggregate's top documents and feedbacks read members inside their windows" */
    it("lists feedbacks on the members' traces inside their windows, never a foreign one", async () => {
      const result = await repository.findFeedbackEvents(read());

      expect(result.events.map((event) => event.event_id).toSorted()).toEqual(IN_WINDOWS);
    });

    /** @scenario "The aggregate's top documents and feedbacks read members inside their windows" */
    it("pages the same feedbacks", async () => {
      const page = await repository.findFeedbackEventsPage({
        ...read(),
        after: undefined,
        limit: 10,
      });

      expect(page.rows.map((row) => row.event.event_id).toSorted()).toEqual(IN_WINDOWS);
      expect(page.hasMore).toBe(false);
    });
  });

  describe("given a proof minted for analytics view, not cost view", () => {
    it("refuses the read before it runs", async () => {
      const proof = analyticsProof({ projectId: AGGREGATE });

      await expect(
        repository.findTopDocuments({ ...read(), authorization: proof }),
      ).rejects.toMatchObject({ code: "access_not_granted" });
    });
  });

  describe("given a plain project's proof", () => {
    it("reads its own documents alone, as before", async () => {
      const result = await repository.findTopDocuments(read(WHOLE_HISTORY_MEMBER));

      expect(result.topDocuments.map((doc) => doc.documentId).toSorted()).toEqual([
        "a-early",
        "a-late",
      ]);
    });
  });
});
