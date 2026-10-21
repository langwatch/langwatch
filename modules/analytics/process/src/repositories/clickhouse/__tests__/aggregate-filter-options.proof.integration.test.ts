import { randomUUID } from "node:crypto";

/**
 * An aggregate's filter pickers offer values from its members inside their grants' windows,
 * and never from a project outside the proof (ADR-177 v4.15).
 * @see specs/governance/aggregate-project.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { FilterField } from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { tenantSet } from "@langwatch/clickhouse-client";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { FindFilterOptionsInput } from "../../filter-options.repository.ts";
import { FilterOptionsClickHouseRepository } from "../clickhouse.filter-options.repository.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

const RUN = randomUUID();
const AGGREGATE = `test-agg-filters-${RUN}`;
const WHOLE_HISTORY_MEMBER = `test-agg-filters-a-${RUN}`;
const LATE_MEMBER = `test-agg-filters-b-${RUN}`;
const FOREIGN = `test-agg-filters-foreign-${RUN}`;
const SEEDED_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"] as const;
const EVALUATOR = `${RUN}-check`;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const LATE_MEMBER_FROM = at("10:00:00");

/** One trace per row; its user, model and evaluator name say which row a picker offered. */
const TRACES: { tenantId: string; time: string; name: string }[] = [
  { tenantId: WHOLE_HISTORY_MEMBER, time: "08:00:00", name: "a-early" },
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:00:00", name: "a-late" },
  { tenantId: LATE_MEMBER, time: "09:30:00", name: "b-before-grant" },
  { tenantId: LATE_MEMBER, time: "10:30:00", name: "b-in-grant" },
  { tenantId: FOREIGN, time: "10:30:00", name: "foreign" },
];
const IN_WINDOWS = ["a-early", "a-late", "b-in-grant"];

let client: ClickHouseClient;
let repository: FilterOptionsClickHouseRepository;

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;
const dateOf = (time: string) => new Date(at(time).epochMilliseconds);

function traceSummaryRow({ tenantId, time, name }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    Version: "v1",
    Attributes: { "langwatch.user_id": name },
    OccurredAt: dateOf(time),
    CreatedAt: dateOf(time),
    UpdatedAt: dateOf(time),
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 200,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: [name],
    TotalCost: 1,
    TokensEstimated: false,
    TotalPromptTokenCount: 0,
    TotalCompletionTokenCount: 0,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

function storedSpanRow({ tenantId, time, name }: (typeof TRACES)[number], index: number) {
  return {
    ProjectionId: `proj-span-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
    SpanId: `span-${RUN}-${index}`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: dateOf(time),
    EndTime: dateOf(time),
    DurationMs: 1,
    SpanName: name,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { "langwatch.span.type": name },
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
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

function evaluationRunRow({ tenantId, time, name }: (typeof TRACES)[number], index: number) {
  const scheduledAt = dateOf(time).toISOString();
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${randomUUID()}`,
    Version: "1",
    EvaluatorId: `${EVALUATOR}-${name}`,
    EvaluatorName: name,
    EvaluatorType: "langevals/exact_match",
    TraceId: traceIdOf(index),
    Status: "processed",
    Score: 1,
    Passed: 1,
    Label: null,
    LastProcessedEventId: `evt-${randomUUID()}`,
    ScheduledAt: scheduledAt,
    UpdatedAt: scheduledAt,
  };
}

/** Member A shared for its whole history, member B only from its grant's start. */
const aggregateProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: WHOLE_HISTORY_MEMBER, from: 0 },
      { projectId: LATE_MEMBER, from: LATE_MEMBER_FROM.epochMilliseconds },
    ],
  });

async function offered({
  field,
  authorization = aggregateProof(),
  scope,
}: {
  field: FilterField;
  authorization?: Authorization;
  scope?: FindFilterOptionsInput["scope"];
}): Promise<string[]> {
  const options = await repository.findOptions({
    field,
    authorization,
    startDate: at("06:00:00").epochMilliseconds,
    endDate: at("14:00:00").epochMilliseconds,
    ...(scope ? { scope } : {}),
  });
  return options.map((option) => option.label).toSorted();
}

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  repository = FilterOptionsClickHouseRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  const seeded: [string, unknown[]][] = [
    ["trace_summaries", TRACES.map(traceSummaryRow)],
    ["stored_spans", TRACES.map(storedSpanRow)],
    ["evaluation_runs", TRACES.map(evaluationRunRow)],
  ];
  for (const [table, values] of seeded) {
    await client.insert({ table, values, format: "JSONEachRow", clickhouse_settings: settings });
  }
}, 300_000);

afterAll(async () => {
  for (const tenantId of [AGGREGATE, WHOLE_HISTORY_MEMBER, LATE_MEMBER, FOREIGN]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: SEEDED_TABLES });
  }
});

describe("filter pickers read under an aggregate's proof", () => {
  describe("given one member shared for its whole history and one from a later start", () => {
    /** @scenario "The aggregate's filter pickers offer member values inside their windows" */
    it("offers trace values from the members inside their windows, never a foreign one", async () => {
      expect(await offered({ field: "metadata.user_id" })).toEqual(IN_WINDOWS);
    });

    /** @scenario "The aggregate's filter pickers offer member values inside their windows" */
    it("offers span values from the members inside their windows, never a foreign one", async () => {
      expect(await offered({ field: "spans.type" })).toEqual(IN_WINDOWS);
    });

    /** @scenario "The aggregate's filter pickers offer member values inside their windows" */
    it("offers evaluators from the members inside their windows, never a foreign one", async () => {
      const labels = await offered({ field: "evaluations.evaluator_id" });

      expect(labels).toEqual(IN_WINDOWS.map((name) => `[langevals/exact_match] ${name}`));
    });

    it("narrows by another filter's side-table subquery without crossing members", async () => {
      // The shape Trace's grammar writes for `evaluations.evaluator_id` in fenced mode.
      const scope = {
        conditions: [
          `EXISTS (
            SELECT 1 FROM evaluation_runs es
            WHERE ${tenantSet()} AND es.TenantId = ts.TenantId
              AND es.TraceId IS NOT NULL
              AND assumeNotNull(es.TraceId) = ts.TraceId
              AND es.EvaluatorId IN ({f0_values:Array(String)})
          )`,
        ],
        params: { f0_values: [`${EVALUATOR}-a-late`, `${EVALUATOR}-foreign`] },
      };

      expect(await offered({ field: "metadata.user_id", scope })).toEqual(["a-late"]);
    });
  });

  describe("given a plain project's proof", () => {
    it("offers its own values alone, as before", async () => {
      const proof = analyticsProof({ projectId: WHOLE_HISTORY_MEMBER });

      expect(await offered({ field: "metadata.user_id", authorization: proof })).toEqual([
        "a-early",
        "a-late",
      ]);
    });
  });
});
