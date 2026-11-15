import { randomUUID } from "node:crypto";

/**
 * Every filter picker built on the typed builder offers main's options on 26.8: main's SQL text
 * (support/main-filter-options.reference.ts) and the built read answer alike, with two tenants
 * that share trace ids and hold different values, under one tenant's proof and under both.
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { FilterField } from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import type { FilterOption } from "../../filter-options.repository.ts";
import type { AnalyticsFilterInput } from "../clickhouse.filter-conditions.mapper.ts";
import { FilterOptionsClickHouseRepository } from "../clickhouse.filter-options.repository.ts";
import { resetParamCounter, translateAllFilters } from "../clickhouse.filter-translator.mapper.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";
import {
  buildScopeConditions,
  type MainFilterQueryParams,
  mainClickHouseFilters,
} from "./support/main-filter-options.reference.ts";

const RUN = randomUUID();
const TENANT_A = `test-picker-proof-a-${RUN}`;
const TENANT_B = `test-picker-proof-b-${RUN}`;
const AGGREGATE = `test-picker-proof-agg-${RUN}`;
const SEEDED_TABLES = ["trace_summaries", "stored_spans", "evaluation_runs"] as const;
const START = Date.UTC(2026, 5, 15, 6);
const END = Date.UTC(2026, 5, 15, 14);
const EVENT = "thumbs_up_down";
/** Trace 4 occurs after the window, so every picker shows the window holds. */
const TRACE_COUNT = 5;

let client: ClickHouseClient;
let repository: FilterOptionsClickHouseRepository;

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;
const timeOf = (index: number) => new Date(Date.UTC(2026, 5, 15, index === 4 ? 15 : 8 + index));

/** One trace, span and evaluation; tenant A's values start `a-`, B's `b-`, ids are shared. */
function seedRows(tenantId: string, index: number) {
  const tag = tenantId === TENANT_A ? "a" : "b";
  const odd = index % 2 === 1;
  const scoreOffset = tag === "a" ? 0 : 100;
  const at = timeOf(index);
  const origin: Record<string, string> =
    [{}, { "langwatch.origin": "evaluation" }, { "langwatch.origin": "" }, {}, {}][index] ?? {};
  return {
    summary: {
      ProjectionId: `proj-${randomUUID()}`,
      TenantId: tenantId,
      TraceId: traceIdOf(index),
      Version: "v1",
      Attributes: {
        "langwatch.user_id": `${tag}-user-${index % 2}`,
        "gen_ai.conversation.id": `${tag}-thread-${index}`,
        "langwatch.customer_id": index === 0 ? "" : `${tag}-customer`,
        "langwatch.labels": JSON.stringify([`${tag}-label-${index % 2}`, "", null, "null"]),
        "langwatch.prompt_ids":
          index === 3 ? "[]" : JSON.stringify([`${tag}-prompt-${index}`, "", "null"]),
        plan: `${tag}-plan-${index % 2}`,
        [`${tag}.custom.key`]: "v",
        "langwatch.internal": "x",
        ...origin,
      },
      OccurredAt: at,
      CreatedAt: at,
      UpdatedAt: at,
      ComputedIOSchemaVersion: "",
      TotalDurationMs: 200,
      SpanCount: 1,
      ContainsErrorStatus: odd ? 1 : 0,
      ContainsOKStatus: 1,
      Models: [`${tag}-model-${index % 2}`, ""],
      TokensEstimated: false,
      OutputFromRootSpan: 0,
      OutputSpanEndTimeMs: 0,
      BlockedByGuardrail: 0,
      TopicId: index === 2 ? null : `${tag}-topic-${index % 2}`,
      SubTopicId: index === 1 ? "" : `${tag}-sub`,
      HasAnnotation: [null, 1, 0, 1, 0][index],
      TraceName: `${tag}-name-${index % 2}`,
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
        "langwatch.span.type": `${tag}-type-${index % 2}`,
        "event.type": index < 3 ? EVENT : `${tag}-event`,
        "event.metrics.vote": tag === "a" ? String(index) : String(10 * index + 0.5),
        [`event.metrics.${tag}_only`]: "1",
        "event.details.comment": `${tag}-comment`,
        [`event.details.${tag}_detail`]: "d",
      },
      ScopeName: "",
      "Events.Timestamp": [],
      "Events.Name": [],
      "Events.Attributes": [],
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
      EvaluatorId: `ev-${index % 2}`,
      EvaluatorName: [null, `${tag}-evaluator`, "", `${tag}-evaluator`, `${tag}-evaluator`][index],
      EvaluatorType: "langevals/exact_match",
      IsGuardrail: odd ? 1 : 0,
      TraceId: traceIdOf(index),
      Status: ["processed", "error", "skipped", "scheduled", "processed"][index],
      Score: index === 1 ? null : index + scoreOffset,
      Passed: [null, 1, 0, 1, 0][index],
      Label: [`${tag}-first`, "succeeded", "", `${tag}-other`, null][index],
      LastProcessedEventId: `evt-${randomUUID()}`,
      ScheduledAt: at.toISOString(),
      UpdatedAt: at.toISOString(),
    },
  };
}

/** Each picker's key and subkey; a keyed evaluation picker is asked for both evaluators. */
const KEYS: Partial<Record<FilterField, { key: string; subkey?: string }[]>> = {
  "metadata.value": [{ key: "plan" }],
  "evaluations.passed": [{ key: "ev-0" }, { key: "ev-1" }],
  "evaluations.score": [{ key: "ev-0" }, { key: "ev-1" }],
  "evaluations.state": [{ key: "ev-0" }, { key: "ev-1" }],
  "evaluations.label": [{ key: "ev-0" }, { key: "ev-1" }],
  "events.metrics.key": [{ key: EVENT }],
  "events.event_details.key": [{ key: EVENT }],
  "events.metrics.value": [{ key: EVENT, subkey: "vote" }],
};

const FIELDS = (Object.keys(mainClickHouseFilters) as FilterField[]).filter(
  (field) => mainClickHouseFilters[field] !== null,
);

type Ask = { query?: string; key?: string; subkey?: string; filters?: AnalyticsFilterInput };

const sorted = (options: FilterOption[]) =>
  options.toSorted((a, b) => `${a.field}|${a.label}`.localeCompare(`${b.field}|${b.label}`));

/** Main's options: its SQL text, narrowed by the text translator's clause, under the proof. */
async function mainOptions({
  field,
  authorization,
  readsMembers,
  ask,
}: {
  field: FilterField;
  authorization: Authorization;
  readsMembers: boolean;
  ask: Ask;
}): Promise<FilterOption[]> {
  const definition = mainClickHouseFilters[field];
  if (!definition) throw new Error(`no reference for ${field}`);
  resetParamCounter();
  const translation = ask.filters
    ? translateAllFilters(ask.filters, {
        spanTimePredicate:
          "AND StartTime >= fromUnixTimestamp64Milli({startDate:UInt64}) - INTERVAL 2 DAY " +
          "AND StartTime < fromUnixTimestamp64Milli({endDate:UInt64}) + INTERVAL 2 DAY",
      })
    : undefined;
  const params: MainFilterQueryParams = {
    startDate: START,
    endDate: END,
    readsMembers,
    ...(ask.query === undefined ? {} : { query: ask.query }),
    ...(ask.key === undefined ? {} : { key: ask.key }),
    ...(ask.subkey === undefined ? {} : { subkey: ask.subkey }),
    ...(translation
      ? { scope: { conditions: [translation.whereClause], params: translation.params } }
      : {}),
  };
  const sql = definition.buildQuery(params);
  if (sql === null) return [];
  const reader = new AuthorizedClickHouse({
    resolveClient: () => Promise.resolve(clickHouseQueryClientOver(client)),
  }).as(authorization, { reads: "analytics" });
  const result = await reader.query({
    query: sql,
    query_params: {
      query: ask.query ?? "",
      key: ask.key ?? "",
      subkey: ask.subkey ?? "",
      startDate: START,
      endDate: END,
      ...buildScopeConditions(params).params,
    },
  });
  return sorted(definition.extractResults(await result.json()));
}

/** The built picker's options, through the repository as the service calls it. */
async function builtOptions({
  field,
  authorization,
  readsMembers,
  ask,
}: {
  field: FilterField;
  authorization: Authorization;
  readsMembers: boolean;
  ask: Ask;
}): Promise<FilterOption[]> {
  return sorted(
    await repository.findOptions({
      field,
      authorization,
      readsMembers,
      startDate: START,
      endDate: END,
      ...(ask.query === undefined ? {} : { query: ask.query }),
      ...(ask.key === undefined ? {} : { key: ask.key }),
      ...(ask.subkey === undefined ? {} : { subkey: ask.subkey }),
      ...(ask.filters ? { filters: ask.filters } : {}),
    }),
  );
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

const asksFor = (field: FilterField): Ask[] => KEYS[field] ?? [{}];

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  repository = FilterOptionsClickHouseRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  const rows = [TENANT_A, TENANT_B].flatMap((tenantId) =>
    Array.from({ length: TRACE_COUNT }, (_, index) => seedRows(tenantId, index)),
  );
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  const seeded: [string, unknown[]][] = [
    ["trace_summaries", rows.map((row) => row.summary)],
    ["stored_spans", rows.map((row) => row.span)],
    ["evaluation_runs", rows.map((row) => row.run)],
  ];
  for (const [table, values] of seeded) {
    await client.insert({ table, values, format: "JSONEachRow", clickhouse_settings: settings });
  }
}, 300_000);

afterAll(async () => {
  for (const tenantId of [TENANT_A, TENANT_B, AGGREGATE]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: SEEDED_TABLES });
  }
});

describe("filter pickers built on the typed builder", () => {
  describe.each([
    { proof: "tenant A's own proof", authorization: ownProof, readsMembers: false },
    { proof: "an aggregate proof over A and B", authorization: bothProof, readsMembers: true },
  ])("given $proof", ({ authorization, readsMembers }) => {
    it.each(FIELDS)("offers main's options for %s", async (field) => {
      for (const ask of asksFor(field)) {
        const expected = await mainOptions({
          field,
          authorization: authorization(),
          readsMembers,
          ask,
        });
        const actual = await builtOptions({
          field,
          authorization: authorization(),
          readsMembers,
          ask,
        });

        expect(expected.length, `${field} ${JSON.stringify(ask)}`).toBeGreaterThan(0);
        expect(actual, `${field} ${JSON.stringify(ask)}`).toEqual(expected);
      }
    });
  });

  describe("given tenant A's own proof", () => {
    it.each(FIELDS)("never offers tenant B's values for %s", async (field) => {
      for (const ask of asksFor(field)) {
        const actual = await builtOptions({
          field,
          authorization: ownProof(),
          readsMembers: false,
          ask,
        });

        expect(JSON.stringify(actual)).not.toMatch(/"b-|b_only|b_detail|b\.custom/);
      }
    });

    it.each(FIELDS)("searches by prefix as main did for %s", async (field) => {
      for (const ask of asksFor(field).map((each) => ({ ...each, query: "A-" }))) {
        const expected = await mainOptions({
          field,
          authorization: ownProof(),
          readsMembers: false,
          ask,
        });
        const actual = await builtOptions({
          field,
          authorization: ownProof(),
          readsMembers: false,
          ask,
        });

        expect(actual, `${field} ${JSON.stringify(ask)}`).toEqual(expected);
      }
    });

    describe.each<{ narrowing: string; filters: AnalyticsFilterInput }>([
      { narrowing: "a row filter", filters: { "traces.error": ["true"] } },
      { narrowing: "a side-table filter", filters: { "evaluations.evaluator_id": ["ev-1"] } },
      { narrowing: "a span filter", filters: { "spans.type": ["a-type-0"] } },
    ])("when narrowed by $narrowing", ({ filters }) => {
      it.each(FIELDS)("offers main's narrowed options for %s", async (field) => {
        for (const ask of asksFor(field).map((each) => ({ ...each, filters }))) {
          const expected = await mainOptions({
            field,
            authorization: ownProof(),
            readsMembers: false,
            ask,
          });
          const actual = await builtOptions({
            field,
            authorization: ownProof(),
            readsMembers: false,
            ask,
          });

          expect(actual, `${field} ${JSON.stringify(ask)}`).toEqual(expected);
        }
      });
    });
  });
});
