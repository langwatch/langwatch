/**
 * The search bar's suggestions and the value pickers on built reads (ADR-202): each returns the
 * values main's text returns under an own proof, an aggregate's tenant set and a windowed share,
 * with another tenant's rows sharing every trace id.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Authorization } from "@langwatch/authorization";
import { tenantScope } from "@langwatch/clickhouse-client";
import { TRACE_ORIGIN_CLICKHOUSE_EXPRESSION } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceSuggestField } from "../../trace-list.repository.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import {
  authorizedClickHouseFor,
  traceQueryClientFor,
} from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const run = nanoid(6);
const AGGREGATE = `proj_vr_agg_${run}`;
const MEMBER = `proj_vr_member_${run}`;
const OTHER = `proj_vr_other_${run}`;
const MINUTE = 60_000;
const base = Date.now() - 60 * MINUTE;
const WINDOW = { from: base - 120 * MINUTE, to: base + 30 * MINUTE };
/** The member's share starts here; its "pre-share" rows are older. */
const SHARE_FROM = base - 30 * MINUTE;

const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

const summary = (tenant: string, traceId: string, env: string, occurredAtMs = base) => ({
  TenantId: tenant,
  TraceId: traceId,
  OccurredAt: at(occurredAtMs),
  CreatedAt: at(occurredAtMs),
  UpdatedAt: at(occurredAtMs),
  _retention_days: 0,
  ComputedInput: "",
  ComputedOutput: "",
  Models: [`gpt-${env}`],
  Attributes: { env, "service.name": `api-${env}`, "langwatch.origin": env === "prod" ? "" : env },
});

const span = (tenant: string, traceId: string, env: string, startMs = base) => ({
  TenantId: tenant,
  TraceId: traceId,
  SpanId: `s_${traceId}_${env}`,
  StartTime: at(startMs),
  EndTime: at(startMs + 1_000),
  UpdatedAt: at(startMs),
  SpanAttributes: { env },
  "Events.Timestamp": [at(startMs)],
  "Events.Name": ["checkpoint"],
  "Events.Attributes": [{ env: `event-${env}` }],
});

/** Main's suggestion columns, as the list service mapped each field. */
const MAIN_COLUMNS: Record<TraceSuggestField, string> = {
  model: "arrayJoin(Models)",
  service: "Attributes['service.name']",
  user: "Attributes['langwatch.user_id']",
  origin: TRACE_ORIGIN_CLICKHOUSE_EXPRESSION,
};

const mainSuggestText = (column: string) => `
  SELECT DISTINCT ${column} AS val
  FROM trace_summaries
  WHERE ${tenantScope("OccurredAt")}
    AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
    AND ${column} LIKE {prefix:String}
    AND (TenantId, TraceId, UpdatedAt) IN (
      SELECT TenantId, TraceId, max(UpdatedAt)
      FROM trace_summaries
      WHERE ${tenantScope("OccurredAt")}
        AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
      GROUP BY TenantId, TraceId
    )
  LIMIT {limit:UInt32}`;

const SAMPLE_SETTINGS = `SETTINGS max_execution_time = 3, timeout_overflow_mode = 'break', max_threads = 8`;

const mainPickerText = {
  attribute: (prefixed: boolean) => `
    SELECT facet_value, 0 AS cnt, 0 AS total_distinct FROM (
      SELECT DISTINCT Attributes[{attrKey:String}] AS facet_value
      FROM trace_summaries
      PREWHERE ${tenantScope("OccurredAt")}
        AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})
        AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64})
        AND mapContains(Attributes, {attrKey:String})
      WHERE Attributes[{attrKey:String}] != ''
        ${prefixed ? "AND lower(Attributes[{attrKey:String}]) LIKE concat({prefix:String}, '%')" : ""}
      LIMIT {sampleRows:UInt32} ${SAMPLE_SETTINGS}
    ) ORDER BY facet_value LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
  span: (prefixed: boolean) => `
    SELECT facet_value, 0 AS cnt, 0 AS total_distinct FROM (
      SELECT DISTINCT SpanAttributes[{attrKey:String}] AS facet_value
      FROM stored_spans
      PREWHERE ${tenantScope("StartTime")}
        AND StartTime >= fromUnixTimestamp64Milli({timeFrom:Int64})
        AND StartTime <= fromUnixTimestamp64Milli({timeTo:Int64})
        AND mapContains(SpanAttributes, {attrKey:String})
      WHERE SpanAttributes[{attrKey:String}] != ''
        ${prefixed ? "AND lower(SpanAttributes[{attrKey:String}]) LIKE concat({prefix:String}, '%')" : ""}
      LIMIT {sampleRows:UInt32} ${SAMPLE_SETTINGS}
    ) ORDER BY facet_value LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
  event: (prefixed: boolean) => `
    SELECT facet_value, 0 AS cnt, 0 AS total_distinct FROM (
      SELECT DISTINCT arrayJoin(arrayFilter(
        ${prefixed ? "v -> v != '' AND lower(v) LIKE concat({prefix:String}, '%')" : "v -> v != ''"},
        arrayMap(m -> m[{attrKey:String}], \`Events.Attributes\`)
      )) AS facet_value
      FROM stored_spans
      PREWHERE ${tenantScope("StartTime")}
        AND StartTime >= fromUnixTimestamp64Milli({timeFrom:Int64})
        AND StartTime <= fromUnixTimestamp64Milli({timeTo:Int64})
        AND arrayExists(m -> mapContains(m, {attrKey:String}), \`Events.Attributes\`)
      LIMIT {sampleRows:UInt32} ${SAMPLE_SETTINGS}
    ) ORDER BY facet_value LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
} as const;

type PickerKind = keyof typeof mainPickerText;

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

async function mainRows({
  authorization,
  query,
  params,
  key,
}: {
  authorization: Authorization;
  query: string;
  params: Record<string, unknown>;
  key: "val" | "facet_value";
}): Promise<string[]> {
  const client = authorizedClickHouseFor(ch).as(authorization, { reads: "traces" });
  const result = await client.query({ query, query_params: params, format: "JSONEachRow" });
  const rows = (await result.json()) as Record<string, string>[];
  return rows.map((row) => row[key]!).toSorted();
}

async function suggested(authorization: Authorization, field: TraceSuggestField, prefix: string) {
  const built = await repo.findDistinctValues({ authorization, field, prefix, limit: 50 });
  const main = await mainRows({
    authorization,
    query: mainSuggestText(MAIN_COLUMNS[field]),
    params: { fromMs: Date.now() - 30 * 24 * 60 * MINUTE, prefix: `${prefix}%`, limit: 50 },
    key: "val",
  });
  return { built: built.toSorted(), main };
}

async function picked(authorization: Authorization, kind: PickerKind, prefix?: string) {
  const query = { authorization, timeRange: WINDOW, attributeKey: "env", limit: 50, offset: 0 };
  const withPrefix = prefix === undefined ? query : { ...query, prefix };
  const read = {
    attribute: () => repo.findAttributeValues(withPrefix),
    span: () => repo.findSpanAttributeValues(withPrefix),
    event: () => repo.findEventAttributeValues(withPrefix),
  }[kind];
  const built = (await read()).values.map((value) => value.value).toSorted();
  const main = await mainRows({
    authorization,
    query: mainPickerText[kind](prefix !== undefined),
    params: {
      timeFrom: WINDOW.from,
      timeTo: WINDOW.to,
      attrKey: "env",
      limit: 50,
      offset: 0,
      sampleRows: 50_000,
      ...(prefix === undefined ? {} : { prefix }),
    },
    key: "facet_value",
  });
  return { built, main };
}

const SCOPES: [string, () => Authorization][] = [
  ["the member's own proof", () => ownProof({ projectId: MEMBER })],
  [
    "an aggregate's tenant set",
    () => aggregateProof({ projectId: AGGREGATE, members: [{ projectId: MEMBER, from: 0 }] }),
  ],
  [
    "a windowed share",
    () =>
      aggregateProof({ projectId: AGGREGATE, members: [{ projectId: MEMBER, from: SHARE_FROM }] }),
  ],
];

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceListClickHouseRepository.create({
    clickhouse: authorizedClickHouseFor(ch),
    reader: traceQueryClientFor(ch),
  });
  const insert = (table: string, values: Record<string, unknown>[]) =>
    ch.insert({ table, values, format: "JSONEachRow" });
  const preShare = base - 60 * MINUTE;
  await insert("trace_summaries", [
    summary(MEMBER, "t1", "prod"),
    summary(MEMBER, "t2", "preview"),
    summary(MEMBER, "t0", "pre-share", preShare),
    summary(AGGREGATE, "t3", "prep"),
    summary(OTHER, "t1", "prod-other"),
    summary(OTHER, "t2", "private"),
  ]);
  await insert("stored_spans", [
    span(MEMBER, "t1", "prod"),
    span(MEMBER, "t2", "preview"),
    span(MEMBER, "t0", "pre-share", preShare),
    span(AGGREGATE, "t3", "prep"),
    span(OTHER, "t1", "prod-other"),
    span(OTHER, "t2", "private"),
  ]);
}, 300_000);

describe.skipIf(!clickHouseConfigured)("the value reads on built statements", () => {
  /** @scenario "Search suggestions and value pickers keep main's values under each scope" */
  it.each(SCOPES)("suggests each field's values under %s as main does", async (_name, proof) => {
    for (const [field, prefix] of [
      ["model", "gpt"],
      ["service", "api-p"],
      ["user", ""],
      ["origin", ""],
    ] as const) {
      const { built, main } = await suggested(proof(), field, prefix);
      expect({ field, built }).toEqual({ field, built: main });
    }
  });

  /** @scenario "Search suggestions and value pickers keep main's values under each scope" */
  it.each(SCOPES)("samples each picker's values under %s as main does", async (_name, proof) => {
    for (const kind of ["attribute", "span", "event"] as const) {
      for (const prefix of [undefined, "pr"]) {
        const { built, main } = await picked(proof(), kind, prefix);
        expect({ kind, prefix, built }).toEqual({ kind, prefix, built: main });
      }
    }
  });

  /** @scenario "Search suggestions and value pickers keep main's values under each scope" */
  it("reads no other tenant's values and none before a windowed share", async () => {
    const own = await picked(ownProof({ projectId: MEMBER }), "attribute");
    const shared = await picked(SCOPES[2]![1](), "event", "event-pr");

    expect(own.built).toEqual(["pre-share", "preview", "prod"]);
    expect(shared.built).toEqual(["event-prep", "event-preview", "event-prod"]);
  });
});
