import { randomUUID } from "node:crypto";

/**
 * Every analytics filter built on the typed builder keeps main's rows: the text translator's
 * clause and the built condition pick the same (tenant, trace) pairs on 26.8, with two tenants
 * that share trace ids and hold opposite values, read under one tenant's proof and under both.
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Authorization } from "@langwatch/authorization";
import { AuthorizedClickHouse, tenantScope as textScope } from "@langwatch/clickhouse-client";
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import {
  type AnalyticsFilterInput,
  analyticsFilterCondition,
} from "../clickhouse.filter-conditions.mapper.ts";
import { resetParamCounter, translateAllFilters } from "../clickhouse.filter-translator.mapper.ts";
import { traceSummaries } from "../clickhouse.trace-summaries.table.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

const RUN = randomUUID();
const TENANT_A = `test-filter-proof-a-${RUN}`;
const TENANT_B = `test-filter-proof-b-${RUN}`;
const AGGREGATE = `test-filter-proof-agg-${RUN}`;
const SEEDED_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"] as const;
const START = new Date("2026-06-15T06:00:00Z");
const END = new Date("2026-06-15T14:00:00Z");
const TRACE_COUNT = 4;

/** Tenant A's even traces and tenant B's odd ones carry the matching values; ids are shared. */
const matches = (tenantId: string, index: number) =>
  tenantId === TENANT_A ? index % 2 === 0 : index % 2 === 1;
const traceIdOf = (index: number) => `trace-${RUN}-${index}`;
const timeOf = (index: number) => new Date(Date.UTC(2026, 5, 15, 8 + index));

function seedRows(tenantId: string, index: number) {
  const on = matches(tenantId, index);
  const at = timeOf(index);
  const attributes: Record<string, string> = {
    "langwatch.user_id": on ? "user-on" : "user-off",
    "gen_ai.conversation.id": on ? "thread-on" : "thread-off",
    "langwatch.customer_id": on ? "customer-on" : "customer-off",
    "langwatch.labels": on ? '["label-on","x"]' : '["y"]',
    "langwatch.prompt_ids": on ? '["prompt-on"]' : '["prompt-off"]',
    "langwatch.metadata.plan": on ? "pro" : "free",
    ...(on ? { "metadata.tier": "gold" } : { "metadata.tier": "" }),
    ...(on ? {} : { "langwatch.origin": "evaluation" }),
  };
  return {
    summary: {
      ProjectionId: `proj-${randomUUID()}`,
      TenantId: tenantId,
      TraceId: traceIdOf(index),
      Version: "v1",
      Attributes: attributes,
      OccurredAt: at,
      CreatedAt: at,
      UpdatedAt: at,
      ComputedIOSchemaVersion: "",
      TotalDurationMs: 200,
      SpanCount: 1,
      ContainsErrorStatus: on ? 1 : 0,
      ContainsOKStatus: 1,
      Models: [],
      TokensEstimated: false,
      OutputFromRootSpan: 0,
      OutputSpanEndTimeMs: 0,
      BlockedByGuardrail: 0,
      TopicId: on ? "topic-on" : "topic-off",
      SubTopicId: on ? "sub-on" : null,
      HasAnnotation: on ? 1 : 0,
      TraceName: on ? "name-on" : "name-off",
    },
    span: {
      ProjectionId: `proj-span-${randomUUID()}`,
      TenantId: tenantId,
      TraceId: traceIdOf(index),
      SpanId: `span-${RUN}-${index}`,
      Sampled: 1,
      StartTime: at,
      EndTime: at,
      DurationMs: 1,
      SpanName: "span",
      SpanKind: 1,
      ServiceName: "test-service",
      ResourceAttributes: {},
      SpanAttributes: {
        "langwatch.span.type": on ? "llm" : "tool",
        "gen_ai.request.model": on ? "gpt-on" : "gpt-off",
      },
      ScopeName: "",
      "Events.Timestamp": [at],
      "Events.Name": [on ? "thumbs_up_down" : "other"],
      "Events.Attributes": [{ vote: "1" }],
      "Links.TraceId": [],
      "Links.SpanId": [],
      "Links.Attributes": [],
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
    },
    run: {
      ProjectionId: `proj-${randomUUID()}`,
      TenantId: tenantId,
      EvaluationId: `eval-${randomUUID()}`,
      Version: "1",
      EvaluatorId: on ? "ev-on" : "ev-off",
      EvaluatorName: "check",
      EvaluatorType: "langevals/exact_match",
      TraceId: traceIdOf(index),
      Status: on ? "processed" : "error",
      Score: on ? 0.9 : null,
      Passed: on ? 1 : null,
      Label: on ? "good" : "succeeded",
      LastProcessedEventId: `evt-${randomUUID()}`,
      ScheduledAt: at.toISOString(),
      UpdatedAt: at.toISOString(),
    },
  };
}

/** One case per handler branch; each picks a strict, non-empty subset of the seeded traces. */
const CASES: [string, AnalyticsFilterInput][] = [
  ["topics.topics", { "topics.topics": ["topic-on"] }],
  ["topics.subtopics", { "topics.subtopics": ["sub-on"] }],
  ["metadata.user_id", { "metadata.user_id": ["user-on"] }],
  ["metadata.thread_id", { "metadata.thread_id": ["thread-on"] }],
  ["metadata.customer_id", { "metadata.customer_id": ["customer-on"] }],
  ["metadata.labels", { "metadata.labels": ["label-on"] }],
  ["metadata.key", { "metadata.key": ["tier"] }],
  ["metadata.value", { "metadata.value": { plan: ["pro"] } }],
  ["metadata.prompt_ids", { "metadata.prompt_ids": ["prompt-on"] }],
  ["traces.origin application", { "traces.origin": ["application"] }],
  ["traces.origin evaluation", { "traces.origin": ["evaluation"] }],
  ["traces.error true", { "traces.error": ["true"] }],
  ["traces.error false", { "traces.error": ["false"] }],
  ["traces.name", { "traces.name": ["name-on"] }],
  ["spans.type", { "spans.type": ["llm"] }],
  ["spans.model", { "spans.model": ["gpt-on"] }],
  ["evaluations.evaluator_id", { "evaluations.evaluator_id": ["ev-on"] }],
  ["guardrails_only", { "evaluations.evaluator_id.guardrails_only": ["ev-on"] }],
  ["has_passed", { "evaluations.evaluator_id.has_passed": ["ev-on", "ev-off"] }],
  ["has_score", { "evaluations.evaluator_id.has_score": ["ev-on", "ev-off"] }],
  ["has_label", { "evaluations.evaluator_id.has_label": ["ev-on", "ev-off"] }],
  ["evaluations.passed keyed", { "evaluations.passed": { "ev-on": ["true"] } }],
  ["evaluations.passed", { "evaluations.passed": ["true"] }],
  ["evaluations.score", { "evaluations.score": { "ev-on": ["0.5", "1"] } }],
  ["evaluations.label", { "evaluations.label": { "ev-on": ["good"] } }],
  ["evaluations.state", { "evaluations.state": ["processed"] }],
  ["events.event_type", { "events.event_type": ["thumbs_up_down"] }],
  ["events.metrics.key keyed", { "events.metrics.key": { thumbs_up_down: ["vote"] } }],
  ["events.metrics.value", { "events.metrics.value": { thumbs_up_down: { vote: ["0.5", "2"] } } }],
  ["events.event_details.key", { "events.event_details.key": { thumbs_up_down: ["vote"] } }],
  ["annotations true", { "annotations.hasAnnotation": ["true"] }],
  ["annotations false", { "annotations.hasAnnotation": ["false"] }],
  [
    "three filters together",
    {
      "topics.topics": ["topic-on", "topic-off"],
      "spans.type": ["llm"],
      "evaluations.state": ["processed"],
    },
  ],
];

let client: ClickHouseClient;

type PairRow = { tenant: unknown; trace: unknown };
const pairs = (rows: PairRow[]) =>
  rows.map((row) => `${String(row.tenant)}/${String(row.trace)}`).toSorted();

/** Main's rows: the text translator's clause under the proof's markers. */
async function mainRows({
  authorization,
  filters,
  negated = false,
}: {
  authorization: Authorization;
  filters: AnalyticsFilterInput;
  negated?: boolean;
}): Promise<string[]> {
  resetParamCounter();
  const translation = translateAllFilters(filters, {
    spanTimePredicate:
      "AND StartTime >= {startDate:DateTime64(3)} - INTERVAL 2 DAY " +
      "AND StartTime < {endDate:DateTime64(3)} + INTERVAL 2 DAY",
  });
  // Main's negate toggle (aggregation-builder buildScopedFilterWhere).
  const clause = negated
    ? (translation.negatedWhereClause ?? `NOT (${translation.whereClause})`)
    : translation.whereClause;
  const reader = new AuthorizedClickHouse({
    resolveClient: () => Promise.resolve(clickHouseQueryClientOver(client)),
  }).as(authorization, { reads: "analytics" });
  const result = await reader.query({
    query: `SELECT ts.TenantId AS tenant, ts.TraceId AS trace FROM trace_summaries ts
      WHERE ${textScope("OccurredAt")} AND (${clause})`,
    query_params: { startDate: START, endDate: END, ...translation.params },
  });
  return pairs((await result.json()) as PairRow[]);
}

/** The built condition's rows, sent as the reader with the scope's tenant setting. */
async function builtRows({
  authorization,
  filters,
  negated = false,
}: {
  authorization: Authorization;
  filters: AnalyticsFilterInput;
  negated?: boolean;
}): Promise<string[]> {
  const scope = tenantScope.fromProof({ authorization, reads: "analytics" });
  const statement = clickhouseRead({ scope })
    .from(traceSummaries)
    .withinWindows()
    .select({ tenant: traceSummaries.TenantId, trace: traceSummaries.TraceId })
    .where(
      analyticsFilterCondition({
        filters,
        ts: traceSummaries,
        spanWindow: { startMs: START.getTime(), endMs: END.getTime() },
        negated,
      }),
    )
    .build();
  const { rows } = await clickHouseQueryClientOver(client).read({ statement });
  return pairs(rows as PairRow[]);
}

const ownProof = () => analyticsProof({ projectId: TENANT_A });
const bothProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: TENANT_A, from: 0 },
      { projectId: TENANT_B, from: 0 },
    ],
  });

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  const rows = [TENANT_A, TENANT_B].flatMap((tenantId) =>
    Array.from({ length: TRACE_COUNT }, (_, index) => seedRows(tenantId, index)),
  );
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  const seeded: [string, unknown[]][] = [
    ["trace_summaries", rows.map((each) => each.summary)],
    ["stored_spans", rows.map((each) => each.span)],
    ["evaluation_runs", rows.map((each) => each.run)],
  ];
  for (const [table, values] of seeded) {
    await client.insert({ table, values, format: "JSONEachRow", clickhouse_settings: settings });
  }
}, 300_000);

afterAll(async () => {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: SEEDED_TABLES });
  }
});

describe("analytics filters built on the typed builder", () => {
  describe("given two tenants sharing trace ids with opposite values", () => {
    it.each(CASES)("%s keeps main's rows under one tenant's proof", async (_name, filters) => {
      const authorization = ownProof();
      const main = await mainRows({ authorization, filters });

      expect(main.length).toBeGreaterThan(0);
      expect(main.every((pair) => pair.startsWith(`${TENANT_A}/`))).toBe(true);
      expect(await builtRows({ authorization, filters })).toEqual(main);
    });

    it.each(CASES)("%s keeps main's rows under a proof reading both", async (_name, filters) => {
      const authorization = bothProof();
      const main = await mainRows({ authorization, filters });

      expect(main.some((pair) => pair.startsWith(`${TENANT_B}/`))).toBe(true);
      expect(await builtRows({ authorization, filters })).toEqual(main);
    });
  });

  describe("given the negate toggle", () => {
    it.each(CASES)(
      "%s negated keeps main's rows under one tenant's proof",
      async (_name, filters) => {
        const authorization = ownProof();
        const main = await mainRows({ authorization, filters, negated: true });

        expect(main.every((pair) => pair.startsWith(`${TENANT_A}/`))).toBe(true);
        expect(await builtRows({ authorization, filters, negated: true })).toEqual(main);
      },
    );

    it.each(CASES)(
      "%s negated keeps main's rows under a proof reading both",
      async (_name, filters) => {
        const authorization = bothProof();
        const main = await mainRows({ authorization, filters, negated: true });

        expect(await builtRows({ authorization, filters, negated: true })).toEqual(main);
      },
    );
  });
});
