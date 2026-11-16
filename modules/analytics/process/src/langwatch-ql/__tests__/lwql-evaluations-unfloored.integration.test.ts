/**
 * @vitest-environment node
 * evaluations takes no floored twin: a newer version of a run may carry an earlier ScheduledAt.
 * A stock read bounded below on ScheduledAt reads the view as written and returns its rows.
 * @see specs/lwql/dedup-floor.feature
 * @see modules/analytics/adrs/006-stock-widget-views-latest-in-order.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { floorLangWatchQLDedup } from "../../rules/lwql-dedup-floor.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import {
  expectRestrictedIdentity,
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  mapPostgresIntoClickHouse,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
  TENANT_A,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

const STOCK = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
        "utf8",
      ),
    ) as { label: string; sql: string }[]
  ).map((query) => [query.label, query.sql]),
);

/** The stock queries that read evaluations bounded below on ScheduledAt. */
const SCHEDULED_READS = [
  "ans-outcomes/reasons",
  "ans-review/audit",
  "ans-review/flagged",
  "ask-cannot/topics",
  "ext-field-accuracy/checks",
  "ext-field-accuracy/wrong",
];

const readsOfView = (sql: string) => sql.match(/\bFROM evaluations\b/g)?.length ?? 0;

const TENANT = TENANT_A.tenantId;
const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;
const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
const onDay = (day: number) => at(PERIOD_START + day * DAY);
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START),
  dashboard_context_period_end: at(PERIOD_END),
  dashboard_context_sources: ["application"],
};

/** The traces the runs evaluate, by day after the period start. */
const TRACES = [
  { trace: "tr-in-1", day: 1, customer: "acme" },
  { trace: "tr-in-2", day: 5, customer: "globex" },
  { trace: "tr-in-3", day: 5.5, customer: "acme" },
  { trace: "tr-prev", day: -3, customer: null },
  { trace: "tr-old", day: -6.5, customer: null },
];

const JUDGE = "Conversation Outcome Judge";
const FIELDS = "Field accuracy per field";
const CHECK = "Quality";

type Version = { day: number; details: string; label?: string; passed?: 0 | 1 };
type Run = { id: string; trace: string; evaluator: string; scheduled: number; versions: Version[] };

/** Each run's two versions, oldest first, by the day each was written. */
const RUNS: Run[] = [
  {
    id: "field-in",
    trace: "tr-in-1",
    evaluator: FIELDS,
    scheduled: 1.1,
    versions: [
      { day: 1.1, details: "Wrong: total, date" },
      { day: 7.5, details: "Wrong: total" },
    ],
  },
  {
    id: "field-fixed",
    trace: "tr-in-2",
    evaluator: FIELDS,
    scheduled: 5.2,
    versions: [
      { day: 5.2, details: "Wrong: date" },
      { day: 5.3, details: "All right" },
    ],
  },
  {
    id: "field-straddle",
    trace: "tr-in-1",
    evaluator: FIELDS,
    scheduled: -0.5,
    versions: [
      { day: -0.5, details: "Wrong: total" },
      { day: 0.5, details: "Wrong: date" },
    ],
  },
  {
    id: "field-before",
    trace: "tr-in-2",
    evaluator: FIELDS,
    scheduled: -3,
    versions: [
      { day: -3, details: "Wrong: total" },
      { day: -2, details: "Wrong: total, date" },
    ],
  },
  {
    id: "judge-in",
    trace: "tr-in-1",
    evaluator: JUDGE,
    scheduled: 1.2,
    versions: [
      { day: 1.2, label: "capability_gap", details: "no refunds" },
      { day: 1.3, label: "refusal", details: "policy" },
    ],
  },
  {
    id: "judge-prev",
    trace: "tr-prev",
    evaluator: JUDGE,
    scheduled: -2.9,
    versions: [
      { day: -2.9, label: "misunderstood", details: "unclear" },
      { day: 0.5, label: "refusal", details: "policy" },
    ],
  },
  {
    id: "judge-late",
    trace: "tr-in-3",
    evaluator: JUDGE,
    scheduled: 5.6,
    versions: [
      { day: 5.6, label: "resolved", details: "fine" },
      { day: 7.5, label: "capability_gap", details: "out of stock" },
    ],
  },
  {
    id: "judge-early",
    trace: "tr-old",
    evaluator: JUDGE,
    scheduled: -7.5,
    versions: [
      { day: -7.5, label: "capability_gap", details: "out of stock" },
      { day: -6, label: "capability_gap", details: "out of stock" },
    ],
  },
  {
    id: "check-flagged",
    trace: "tr-in-2",
    evaluator: CHECK,
    scheduled: 5.1,
    versions: [
      { day: 5.1, passed: 1, details: "on time" },
      { day: 7.2, passed: 0, details: "missed the date" },
    ],
  },
  {
    id: "check-recovered",
    trace: "tr-in-3",
    evaluator: CHECK,
    scheduled: 5.7,
    versions: [
      { day: 5.7, passed: 0, details: "late" },
      { day: 5.8, passed: 1, details: "on time" },
    ],
  },
  {
    id: "check-straddle",
    trace: "tr-in-1",
    evaluator: CHECK,
    scheduled: 3.9,
    versions: [
      { day: 3.9, passed: 0, details: "late" },
      { day: 4.5, passed: 0, details: "still late" },
    ],
  },
];

function traceRow({ trace, day, customer }: (typeof TRACES)[number]): Record<string, unknown> {
  return {
    TenantId: TENANT,
    TraceId: trace,
    Version: "1",
    OccurredAt: onDay(day),
    CreatedAt: onDay(day),
    UpdatedAt: onDay(day),
    TraceName: trace,
    CustomerId: customer,
    Origin: "application",
    Models: ["gpt-5"],
    TotalCost: 0.5,
    TotalDurationMs: 1000,
    HasError: false,
  };
}

/** The `evaluation_runs` row each run wrote as its `version`th version. */
function runRows(version: number): Record<string, unknown>[] {
  return RUNS.flatMap(({ id, trace, evaluator, scheduled, versions }) => {
    const written = versions[version];
    if (!written) return [];
    return [
      {
        ProjectionId: id,
        TenantId: TENANT,
        EvaluationId: id,
        Version: String(version + 1),
        EvaluatorId: evaluator,
        EvaluatorType: "llm",
        EvaluatorName: evaluator,
        TraceId: trace,
        IsGuardrail: 0,
        Status: "processed",
        Passed: written.passed ?? null,
        Label: written.label ?? null,
        Details: written.details,
        CreatedAt: onDay(scheduled),
        ScheduledAt: onDay(scheduled),
        UpdatedAt: onDay(written.day),
        LastEventOccurredAt: onDay(written.day),
      },
    ];
  });
}

/** Rows in a stable order: a stock query's ORDER BY can tie, or be absent. */
const stable = (rows: Record<string, unknown>[]) =>
  rows.map((row) => JSON.stringify(row)).toSorted();

describe("given evaluation runs whose versions straddle each stock bound", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let client: ClickHouseClient;

  async function rows(sql: string): Promise<Record<string, unknown>[]> {
    const result = await client.query({
      query: sql,
      query_params: PARAMETERS,
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  }

  beforeAll(async () => {
    // ask-cannot/topics reads `topics`, which is PostgreSQL-resident.
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({
      suite: "evaluations-unfloored",
      facts: "migrated",
    });
    const { names, factDatabase: facts } = harness;
    await mapPostgresIntoClickHouse({ harness, postgres });
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({ names, sourceDatabase: facts, dedup: SHIPPED_LWQL_DEDUP }),
    );
    await harness.applyAccessModel({ views: LWQL_VIEW_CATALOG, sourceDatabase: facts });
    await harness.admin.insert({
      table: `${facts}.trace_analytics`,
      format: "JSONEachRow",
      values: TRACES.map(traceRow),
    });
    // One insert per version, so each version lands in its own part, as the fold's writes do.
    for (const version of [0, 1]) {
      await harness.admin.insert({
        table: `${facts}.evaluation_runs`,
        format: "JSONEachRow",
        values: runRows(version),
      });
    }
    client = createClient({
      ...harness.restrictedConnection(),
      database: names.database,
      clickhouse_settings: { [names.tenantSetting]: harness.tenantA.keyHash },
    });
    await expectRestrictedIdentity({ client, names });
  }, 600_000);

  afterAll(async () => {
    await client?.close();
    await harness?.stop();
    await postgres?.stop();
  });

  /** @scenario "Every stock read of evaluations bounded below on ScheduledAt reads the view as written and returns its rows" */
  it("names every stock query that reads evaluations bounded below on ScheduledAt", () => {
    const bounded = [...STOCK]
      .filter(([, sql]) => readsOfView(sql) > 0 && sql.includes("ScheduledAt >="))
      .map(([label]) => label);

    expect(bounded.toSorted()).toEqual(SCHEDULED_READS);
  });

  /** @scenario "Every stock read of evaluations bounded below on ScheduledAt reads the view as written and returns its rows" */
  it.each(SCHEDULED_READS)(
    "reads evaluations as written for %s and returns its rows",
    async (label) => {
      const sql = STOCK.get(label) ?? "";
      const sent = floorLangWatchQLDedup({
        sql,
        database: harness.names.database,
        views: LWQL_VIEW_CATALOG,
      });
      const written = await rows(sql);

      expect(sent, label).not.toContain("evaluations__floor(");
      expect(readsOfView(sent), label).toBe(readsOfView(sql));
      expect(written.length, label).toBeGreaterThan(0);
      expect(stable(await rows(sent)), label).toEqual(stable(written));
    },
  );
});
