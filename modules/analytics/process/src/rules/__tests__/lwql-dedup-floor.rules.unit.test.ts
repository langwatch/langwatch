/**
 * @vitest-environment node
 * A read bounded below on a view's floor column is sent to the floored view, and only then.
 * @see specs/lwql/dedup-floor.feature
 * @see modules/analytics/adrs/005-evaluation-metrics-dedup-floor.md
 * @see modules/analytics/adrs/006-stock-widget-views-latest-in-order.md
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LangWatchQLViewDedupService } from "../../features/provisioning/services/langwatch-ql-view-dedup.service.ts";
import {
  LangWatchQLViewStatementsService,
  SHIPPED_LWQL_DEDUP,
} from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import type { LangWatchQLNames } from "../../services/langwatch-ql-access-model.service.ts";
import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { floorLangWatchQLDedup, flooredViewNames } from "../lwql-dedup-floor.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const START = "{dashboard_context_period_start:DateTime}";
const END = "{dashboard_context_period_end:DateTime}";

/** The twin's argument for `bound`: moved into server-local time, which the parameter reads. */
const floorOf = (bound: string) => `toTimeZone(toDateTime64((${bound}), 3), timezone())`;

const send = (sql: string) =>
  floorLangWatchQLDedup({ sql, database: "lwql", views: LWQL_VIEW_CATALOG });

const stock = new Map(
  (
    JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../../langwatch-ql/__tests__/fixtures/stock-widget-queries.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as { label: string; sql: string }[]
  ).map((query) => [query.label, query.sql]),
);

describe("given a statement that reads evaluation_metrics", () => {
  describe("when it is bounded below on OccurredAt itself", () => {
    /** @scenario "A read bounded below on OccurredAt deduplicates only from that bound" */
    it("reads the floored view from that bound, under the name it was written with", () => {
      expect(
        send(
          `SELECT TraceId FROM evaluation_metrics WHERE OccurredAt >= ${START} AND OccurredAt < ${END}`,
        ),
      ).toBe(
        `SELECT TraceId FROM evaluation_metrics__floor(lwql_floor = ${floorOf(START)}) AS evaluation_metrics ` +
          `WHERE OccurredAt >= ${START} AND OccurredAt < ${END}`,
      );
    });

    /** @scenario "A read bounded below on OccurredAt deduplicates only from that bound" */
    it("keeps an alias and a database, and reads a bound written on either side", () => {
      expect(
        send(`SELECT e.TraceId FROM lwql.evaluation_metrics AS e WHERE ${START} <= e.OccurredAt`),
      ).toBe(
        `SELECT e.TraceId FROM lwql.evaluation_metrics__floor(lwql_floor = ${floorOf(START)}) AS e ` +
          `WHERE ${START} <= e.OccurredAt`,
      );
    });

    /** @scenario "A read bounded below on OccurredAt deduplicates only from that bound" */
    it("floors each reference by its own bound", () => {
      const sent = send(
        `SELECT TraceId FROM evaluation_metrics WHERE OccurredAt >= ${START} ` +
          `AND TraceId IN (SELECT TraceId FROM evaluation_metrics WHERE OccurredAt > subtractDays(${START}, 7))`,
      );

      expect(sent).toContain(`evaluation_metrics__floor(lwql_floor = ${floorOf(START)})`);
      expect(sent).toContain(
        `evaluation_metrics__floor(lwql_floor = ${floorOf(`subtractDays(${START}, 7)`)})`,
      );
    });

    /** @scenario "A read bounded below on OccurredAt deduplicates only from that bound" */
    it("floors a table whose alias a FROM subquery around it reuses", () => {
      const sent = send(
        `SELECT e.TraceId FROM (SELECT e.TraceId AS TraceId FROM evaluation_metrics AS e ` +
          `WHERE e.OccurredAt >= ${START}) AS e`,
      );

      expect(sent).toContain(`evaluation_metrics__floor(lwql_floor = ${floorOf(START)}) AS e`);
    });

    /** @scenario "A bound in another time zone floors from the same instant" */
    it("moves a bound written in another zone into the server's zone", () => {
      const bound = "toDateTime('2024-06-01 08:00:00','Asia/Tokyo')";

      expect(send(`SELECT TraceId FROM evaluation_metrics WHERE OccurredAt >= ${bound}`)).toBe(
        `SELECT TraceId FROM evaluation_metrics__floor(lwql_floor = ${floorOf(bound)}) ` +
          `AS evaluation_metrics WHERE OccurredAt >= ${bound}`,
      );
    });

    /** @scenario "A read bounded below on OccurredAt deduplicates only from that bound" */
    it.each([
      ["date arithmetic with an INTERVAL", `${START} - INTERVAL 7 DAY`],
      ["now()", "now()"],
      ["today() as a DateTime", "toDateTime(today())"],
      ["a literal", "'2024-06-01 00:00:00'"],
      ["addDays over a cast", "addDays(CAST('2024-06-01' AS DateTime), 1)"],
    ])("floors a bound of %s, wrapped whole", (_case, bound) => {
      expect(send(`SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= ${bound}`)).toContain(
        `evaluation_metrics__floor(lwql_floor = ${floorOf(bound)})`,
      );
    });

    /** @scenario "A read bounded below on OccurredAt deduplicates only from that bound" */
    it("floors the evaluation reads of the attribution stock queries", () => {
      for (const [label, view] of [
        ["att-table/passRates", "trace_evaluation_metrics"],
        ["att-change/units", "trace_evaluation_metrics"],
        ["ck-attention/agreement", "trace_evaluation_checks"],
      ] as const) {
        const sent = send(stock.get(label) ?? "");
        expect(sent, label).toContain(`${view}__floor(lwql_floor = `);
        expect(sent, label).not.toMatch(new RegExp(`FROM ${view}\\s`));
      }
    });
  });

  describe("when it is bounded on another time column", () => {
    /** @scenario "A read bounded on another column keeps the whole-history dedup" */
    it("is sent as written", () => {
      const sql = `SELECT TraceId FROM evaluation_metrics WHERE UpdatedAt >= ${START}`;

      expect(send(sql)).toBe(sql);
    });
  });

  describe("when it has no window", () => {
    /** @scenario "A read with no window keeps the whole-history dedup" */
    it("is sent as written", () => {
      const sql = "SELECT TraceId FROM evaluation_metrics WHERE Passed IS NOT NULL";

      expect(send(sql)).toBe(sql);
    });
  });

  describe("when its bound cannot filter the view's rows before the statement reads them", () => {
    /** @scenario "A bound that cannot filter the view first is not pushed" */
    it.each([
      ["an upper bound only", `SELECT 1 FROM evaluation_metrics WHERE OccurredAt < ${END}`],
      [
        "a bound inside an OR",
        `SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= ${START} OR Passed = 1`,
      ],
      [
        "a bound that reads a column",
        "SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= CreatedAt",
      ],
      [
        "a select alias that shadows the column",
        `SELECT now() AS OccurredAt FROM evaluation_metrics WHERE OccurredAt >= ${START}`,
      ],
      [
        "a select alias that shadows the table's alias",
        `SELECT now() AS e FROM evaluation_metrics AS e WHERE e.OccurredAt >= ${START}`,
      ],
      [
        "a select alias that shadows the table's name",
        `SELECT tuple(1) AS evaluation_metrics FROM evaluation_metrics ` +
          `WHERE evaluation_metrics.OccurredAt >= ${START}`,
      ],
      ["a NULL bound", "SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= NULL"],
      [
        "a bound that calls a non-constant function",
        "SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= fromUnixTimestamp(rand())",
      ],
      [
        "a bound that calls a function outside the allow-list",
        `SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= toDateTime(randomString(4))`,
      ],
      [
        "a dateDiff over a column",
        "SELECT 1 FROM evaluation_metrics " +
          "WHERE OccurredAt >= now() - toIntervalSecond(dateDiff('second', UpdatedAt, now()))",
      ],
      [
        "a multiply over a column",
        "SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= subtractSeconds(now(), multiply(Score, 60))",
      ],
      [
        "an intDiv over a column",
        "SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= subtractSeconds(now(), intDiv(Score, 2))",
      ],
      [
        "a bound that calls a generator",
        "SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= toDateTime(generateUUIDv4())",
      ],
      [
        "the outer side of a LEFT JOIN",
        `SELECT 1 FROM trace_metrics AS t LEFT JOIN evaluation_metrics AS e ON e.TraceId = t.TraceId ` +
          `WHERE e.OccurredAt >= ${START}`,
      ],
      [
        "an unqualified bound with a second table",
        `SELECT 1 FROM evaluation_metrics AS e INNER JOIN trace_metrics AS t ON t.TraceId = e.TraceId ` +
          `WHERE OccurredAt >= ${START}`,
      ],
      [
        "a WITH name spelt like the view",
        `WITH evaluation_metrics AS (SELECT 1 AS OccurredAt) SELECT 1 FROM evaluation_metrics WHERE OccurredAt >= ${START}`,
      ],
    ])("sends %s as written", (_case, sql) => {
      expect(send(sql)).toBe(sql);
    });
  });
});

describe("given a view whose dedup declares no floor column", () => {
  /** @scenario "A read bounded on another column keeps the whole-history dedup" */
  it("sends a read bounded on its time column as written", () => {
    const sql = `SELECT ScenarioRunId FROM simulations WHERE StartedAt >= ${START}`;

    expect(send(sql)).toBe(sql);
  });
});

describe("given a statement that reads a latest-in-order view", () => {
  /** @scenario "A read bounded below on a latest-in-order view's floor column reads its floored twin" */
  it("reads trace_metrics' floored twin from the bound on OccurredAt", () => {
    const where = `WHERE OccurredAt >= ${START} AND OccurredAt < ${END}`;

    expect(send(`SELECT TraceId FROM trace_metrics ${where}`)).toBe(
      `SELECT TraceId FROM trace_metrics__floor(lwql_floor = ${floorOf(START)}) ` +
        `AS trace_metrics ${where}`,
    );
  });

  /** @scenario "A read bounded below on a latest-in-order view's floor column reads its floored twin" */
  it("floors a bound that takes the least of two query constants", () => {
    const bound = `least(subtractDays(${START}, 1), subtractDays(${START}, 90))`;

    expect(send(`SELECT 1 FROM trace_metrics WHERE OccurredAt >= ${bound}`)).toContain(
      `trace_metrics__floor(lwql_floor = ${floorOf(bound)})`,
    );
  });

  /** @scenario "A read bounded below on traces.OccurredAt or evaluations.ScheduledAt keeps the whole-history dedup" */
  it.each([
    ["traces", "OccurredAt"],
    ["evaluations", "ScheduledAt"],
  ])("sends a %s read bounded on %s as written", (view, column) => {
    const sql = `SELECT TraceId FROM ${view} WHERE ${column} >= ${START} AND ${column} < ${END}`;

    expect(send(sql)).toBe(sql);
  });

  /** @scenario "A read bounded below on traces.OccurredAt or evaluations.ScheduledAt keeps the whole-history dedup" */
  it("sends a saved widget's aliased evaluations read with a lower date bound as written", () => {
    const sql =
      "SELECT e.EvaluatorName, count() AS runs FROM lwql.evaluations AS e " +
      `WHERE e.ScheduledAt >= least(subtractDays(${START}, 1), subtractDays(${START}, 90)) ` +
      "GROUP BY e.EvaluatorName";

    expect(send(sql)).toBe(sql);
  });

  /** @scenario "Every trace_metrics read of the changes and capability-gap stock queries reads its floored twin" */
  it.each(["ck-trend/changes", "ext-cost-per-doc/changes", "ck-top-ask/gap"])(
    "sends every trace_metrics read of %s to its floored twin and its traces reads as written",
    (label) => {
      const sql = stock.get(label) ?? "";
      const metricsReads = sql.match(/FROM trace_metrics\b/g) ?? [];
      const tracesReads = sql.match(/FROM traces\b/g) ?? [];
      const sent = send(sql);

      expect(metricsReads.length, label).toBeGreaterThan(0);
      expect(sent.match(/FROM trace_metrics__floor\(lwql_floor = /g), label).toHaveLength(
        metricsReads.length,
      );
      expect(sent.match(/FROM traces\b/g) ?? [], label).toHaveLength(tracesReads.length);
      expect(sent, label).not.toContain("traces__floor");
    },
  );
});

/**
 * The deduplicated views that take no floor, and why. Every other one declares a floor column,
 * so a new view cannot ship reading its whole history by accident (analytics ADR-006).
 */
const UNFLOORED: Readonly<Record<string, string>> = {
  // FINAL keeps the caller's WHERE on the table read, so partitions prune without a twin.
  spans: "FINAL: the caller's bound reaches the read",
  coding_session_events: "FINAL: the caller's bound reaches the read",
  coding_tool_results: "FINAL: the caller's bound reaches the read",
  judgments: "FINAL: the caller's bound reaches the read",
  // Rollups group on their key and supersede no version, so there is no dedup to floor.
  trace_metrics_by_minute: "aggregating rollup: no version to floor",
  model_usage_by_minute: "aggregating rollup: no version to floor",
  evaluation_metrics_by_minute: "aggregating rollup: no version to floor",
  gateway_budget_totals: "aggregating rollup: no version to floor",
  simulation_metric_rollups: "aggregating rollup: no version to floor",
  simulations: "StartedAt falls between versions: a run's queued row is stamped at fold time",
  coding_sessions: "StartedAt is the minimum of the session's signals, so it falls (ADR-071)",
  traces: "OccurredAt can fall when a fold misses its row (trace-summary.projection.ts:144,222)",
  evaluations: "ScheduledAt can fall: a fold that misses or reads stale restamps it (ADR-006)",
  // A floor on these would be exact (time column in the dedup key, or the version itself).
  experiment_items: "follow-up: floor on OccurredAt, the version column",
  simulation_trace_metrics: "follow-up: floor on OccurredAt, the version column",
  governance_daily_cost_rollup: "follow-up: Day is in the dedup key",
  governance_hourly_kpis: "follow-up: HourBucket is in the dedup key",
  langy_usage_events: "follow-up: OccurredAt is in the dedup key",
  logs: "follow-up: TimeUnixMs is in the dedup key",
  metric_points: "follow-up: TimeUnixMs is in the dedup key",
  metric_rollups: "follow-up: BucketStart is in the dedup key",
  metric_series_definitions: "follow-up: floor on LastSeenAt, the version column",
  session_metrics: "follow-up: floor on AsOf, the version column",
  // Whether the time column holds across a row's versions is not yet read from their writers.
  experiment_run_results: "not analysed: StartedAt stability across versions",
  gateway_request_spend: "not analysed: OccurredAt stability across versions",
  billing_events: "not analysed: EventTimestamp stability across versions",
  coding_trace_sessions: "not analysed: OccurredAt stability across versions",
  dspy_optimizer_steps: "not analysed: CreatedAt stability across versions",
  gateway_budget_ledger: "not analysed: OccurredAt stability across versions",
  governance_cost_restatements: "not analysed: Day stability across versions",
  governance_security_events: "not analysed: EventTime stability across versions",
  langy_conversation_messages: "not analysed: CreatedAt stability across versions",
  legacy_event_log: "not analysed: EventOccurredAt stability across versions",
  legacy_log_records: "not analysed: TimeUnixMs stability across versions",
  legacy_metric_records: "not analysed: TimeUnixMs stability across versions",
  log_ingestion_usage: "not analysed: AcceptedAt stability across versions",
  metric_ingestion_usage: "not analysed: AcceptedAt stability across versions",
  objects: "not analysed: created_at stability across versions",
  test_suite_runs: "not analysed: StartedAt stability across versions",
};

/** The provisioning service's inputs (langwatch-ql-view-provisioning.service.ts). */
const NAMES: LangWatchQLNames = {
  database: "langwatch",
  restrictedUser: "langwatch_lwql",
  settingsProfile: "lwql_restricted",
  keyMapTable: "lwql_api_key_tenant_map",
  tenantSetting: "custom_api_key_hash",
};

describe("given every view the catalog deduplicates", () => {
  const viewStatements = LangWatchQLViewStatementsService.create();
  const catalogShapes = LangWatchQLCatalogShapesService.create();
  const viewDedup = LangWatchQLViewDedupService.create();
  // A PostgreSQL-resident view holds one row per key and renders no dedup.
  const deduplicated = LWQL_VIEW_CATALOG.filter(
    (view) =>
      !catalogShapes.isPostgresResident(view) &&
      viewDedup.strategyFor({ view, dedup: SHIPPED_LWQL_DEDUP }) !== "none",
  );

  /** @scenario "Every deduplicated view floors a bounded read or says why it cannot" */
  it("declares a floor column on each, or lists it with the reason it takes none", () => {
    const unexplained = deduplicated
      .filter((view) => view.dedup.floorColumn === undefined && !(view.name in UNFLOORED))
      .map((view) => view.name);

    expect(unexplained).toEqual([]);
  });

  /** @scenario "Every deduplicated view floors a bounded read or says why it cannot" */
  it("lists only deduplicated views that declare no floor column", () => {
    const listed = new Set(
      deduplicated.filter((view) => view.dedup.floorColumn === undefined).map(({ name }) => name),
    );

    expect(Object.keys(UNFLOORED).filter((name) => !listed.has(name))).toEqual([]);
  });

  /** @scenario "Every deduplicated view floors a bounded read or says why it cannot" */
  it("provisions a floored twin for each view that declares a floor column", () => {
    const floored = deduplicated.filter((view) => view.dedup.floorColumn !== undefined);
    const twinsOf = (view: (typeof floored)[number]) =>
      viewStatements.flooredViewStatements({
        names: NAMES,
        sourceDatabase: "langwatch",
        view,
        dedup: SHIPPED_LWQL_DEDUP,
      });

    expect(floored.map((view) => [view.name, flooredViewNames([view]).length])).toEqual(
      floored.map((view) => [view.name, 1]),
    );
    expect(floored.map((view) => [view.name, twinsOf(view).length])).toEqual(
      floored.map((view) => [view.name, 1]),
    );
  });
});

describe("given a statement that reads a settled view over trace_evaluation_analytics", () => {
  /** @scenario "A read bounded below on OccurredAt reads the settled view's floored twin" */
  it("reads trace_evaluation_checks__floor from the bound on OccurredAt", () => {
    expect(
      send(
        `SELECT sum(Evaluations) FROM trace_evaluation_checks WHERE OccurredAt >= ${START} AND TraceOccurredAt < ${END}`,
      ),
    ).toBe(
      `SELECT sum(Evaluations) FROM trace_evaluation_checks__floor(lwql_floor = ${floorOf(START)}) AS trace_evaluation_checks ` +
        `WHERE OccurredAt >= ${START} AND TraceOccurredAt < ${END}`,
    );
  });
});

describe("given the stock queries that read the trace evaluations", () => {
  const MOVED = [
    "ans-outcomes/totals",
    "ans-topics/topics",
    "att-change/units",
    "att-table/passRates",
    "ck-attention/agreement",
    "ck-attention/reasons",
    "ck-attention/segments",
    "ck-kpis/checks",
    "ck-kpis/outcomes",
    "ck-top-ask/gap",
    "cost-verdict/outcomes",
    "rag-failure-source/trend",
  ];

  /** @scenario "Every read of the trace evaluations in a moved stock query reads the floored twin" */
  it("sends every trace evaluation read of the moved queries to its floored twin", () => {
    for (const label of MOVED) {
      const sql = stock.get(label) ?? "";
      const reads = sql.match(/FROM trace_evaluation_(metrics|checks)\b/g) ?? [];
      const sent = send(sql);

      expect(reads.length, label).toBeGreaterThan(0);
      expect(
        sent.match(/FROM trace_evaluation_(metrics|checks)__floor\(lwql_floor = /g),
        label,
      ).toHaveLength(reads.length);
    }
  });
});
