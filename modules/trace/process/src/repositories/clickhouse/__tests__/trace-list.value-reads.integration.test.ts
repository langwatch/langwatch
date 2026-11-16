/**
 * The search bar's suggestions and the value pickers on built reads (ADR-202): each returns the
 * values main returned on 26.8 (kept as literals) under an own proof, an aggregate's tenant
 * set and a windowed share, with another tenant's rows sharing every trace id.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Authorization } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceSuggestField } from "../../trace-list.repository.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
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

type PickerKind = "attribute" | "span" | "event";

/** Main's answers on 26.8 for one scope: each suggest field's values and each picker's sample. */
type MainAnswers = {
  suggested: Record<TraceSuggestField, string[]>;
  picked: Record<PickerKind, { all: string[]; pr: string[] }>;
};

const envs = (...names: string[]) => ({ all: names, pr: names });

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

async function suggested(authorization: Authorization, field: TraceSuggestField, prefix: string) {
  const built = await repo.findDistinctValues({ authorization, field, prefix, limit: 50 });
  return built.toSorted();
}

async function picked(authorization: Authorization, kind: PickerKind, prefix?: string) {
  const query = { authorization, timeRange: WINDOW, attributeKey: "env", limit: 50, offset: 0 };
  const withPrefix = prefix === undefined ? query : { ...query, prefix };
  const read = {
    attribute: () => repo.findAttributeValues(withPrefix),
    span: () => repo.findSpanAttributeValues(withPrefix),
    event: () => repo.findEventAttributeValues(withPrefix),
  }[kind];
  return (await read()).values.map((value) => value.value).toSorted();
}

const SCOPES: [string, () => Authorization, MainAnswers][] = [
  [
    "the member's own proof",
    () => ownProof({ projectId: MEMBER }),
    {
      suggested: {
        model: ["gpt-pre-share", "gpt-preview", "gpt-prod"],
        service: ["api-pre-share", "api-preview", "api-prod"],
        user: [""],
        origin: ["application", "pre-share", "preview"],
      },
      picked: {
        attribute: envs("pre-share", "preview", "prod"),
        span: envs("pre-share", "preview", "prod"),
        event: { all: ["event-pre-share", "event-preview", "event-prod"], pr: [] },
      },
    },
  ],
  [
    "an aggregate's tenant set",
    () => aggregateProof({ projectId: AGGREGATE, members: [{ projectId: MEMBER, from: 0 }] }),
    {
      suggested: {
        model: ["gpt-pre-share", "gpt-prep", "gpt-preview", "gpt-prod"],
        service: ["api-pre-share", "api-prep", "api-preview", "api-prod"],
        user: [""],
        origin: ["application", "pre-share", "prep", "preview"],
      },
      picked: {
        attribute: envs("pre-share", "prep", "preview", "prod"),
        span: envs("pre-share", "prep", "preview", "prod"),
        event: {
          all: ["event-pre-share", "event-prep", "event-preview", "event-prod"],
          pr: [],
        },
      },
    },
  ],
  [
    "a windowed share",
    () =>
      aggregateProof({ projectId: AGGREGATE, members: [{ projectId: MEMBER, from: SHARE_FROM }] }),
    {
      suggested: {
        model: ["gpt-prep", "gpt-preview", "gpt-prod"],
        service: ["api-prep", "api-preview", "api-prod"],
        user: [""],
        origin: ["application", "prep", "preview"],
      },
      picked: {
        attribute: envs("prep", "preview", "prod"),
        span: envs("prep", "preview", "prod"),
        event: { all: ["event-prep", "event-preview", "event-prod"], pr: [] },
      },
    },
  ],
];

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceListClickHouseRepository.create({
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
  it.each(SCOPES)(
    "suggests each field's values under %s as main does",
    async (_name, proof, main) => {
      for (const [field, prefix] of [
        ["model", "gpt"],
        ["service", "api-p"],
        ["user", ""],
        ["origin", ""],
      ] as const) {
        const built = await suggested(proof(), field, prefix);
        expect({ field, built }).toEqual({ field, built: main.suggested[field] });
      }
    },
  );

  /** @scenario "Search suggestions and value pickers keep main's values under each scope" */
  it.each(SCOPES)(
    "samples each picker's values under %s as main does",
    async (_name, proof, main) => {
      for (const kind of ["attribute", "span", "event"] as const) {
        for (const prefix of [undefined, "pr"]) {
          const built = await picked(proof(), kind, prefix);
          const expected = main.picked[kind][prefix === undefined ? "all" : "pr"];
          expect({ kind, prefix, built }).toEqual({ kind, prefix, built: expected });
        }
      }
    },
  );

  /** @scenario "Search suggestions and value pickers keep main's values under each scope" */
  it("reads no other tenant's values and none before a windowed share", async () => {
    const own = await picked(ownProof({ projectId: MEMBER }), "attribute");
    const shared = await picked(SCOPES[2]![1](), "event", "event-pr");

    expect(own).toEqual(["pre-share", "preview", "prod"]);
    expect(shared).toEqual(["event-prep", "event-preview", "event-prod"]);
  });
});
