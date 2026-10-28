/**
 * The origin scope read by a real ClickHouse as the restricted identity, over the shipped
 * migrations and views: a run that leaves Langy out counts none of Langy's traces or their rows.
 * @see modules/analytics/adrs/003-lwql-origin-scope.md
 * @vitest-environment node
 */
import {
  KNOWN_TRACE_ORIGINS,
  TRACE_SOURCES,
  type TraceSource,
} from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import { LangWatchQLService } from "../../services/langwatch-ql.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

/** A day no harness seed writes to, so every count below is of the rows this suite inserts. */
const AT = "2026-06-10 12:00:00.000";
const WINDOW = { start: "2026-06-10T00:00:00.000Z", end: "2026-06-11T00:00:00.000Z" };
const VIEWS = ["traces", "spans", "trace_metrics", "evaluations", "evaluation_metrics"];
/** The agent's own traces, one of them not stamped with an origin yet, and Langy's turns. */
const TRACES = [
  { id: "agent-stamped", origin: "application" },
  { id: "agent-unstamped", origin: "" },
  { id: "langy-turn-1", origin: "langy" },
  { id: "langy-turn-2", origin: "langy" },
];
const SPANS_PER_TRACE = 2;
/** Langy's turns on a day of their own: stored by the gateway, origin langy (AC201). */
const TURN_AT = "2026-06-12 12:00:00.000";
const TURN_WINDOW = { start: "2026-06-12T00:00:00.000Z", end: "2026-06-13T00:00:00.000Z" };
const TURN_IDS = ["gateway-turn-1", "gateway-turn-2"];
/**
 * One trace per origin on a day of their own (AC200l): unstamped (the key missing, or empty), one
 * origin LangWatch does not list, and each listed one. trace_analytics.Origin is a String, so
 * NULL is tried where the column is Nullable: an evaluation with no origin.
 */
const SOURCES_AT = "2026-06-14 12:00:00.000";
const SOURCES_WINDOW = { start: "2026-06-14T00:00:00.000Z", end: "2026-06-15T00:00:00.000Z" };
const SOURCE_TRACES: readonly { id: string; origin?: string }[] = [
  { id: "src-missing" },
  { id: "src-empty", origin: "" },
  { id: "src-unlisted", origin: "brand_new_origin" },
  ...KNOWN_TRACE_ORIGINS.map((origin) => ({ id: `src-${origin}`, origin })),
];
const SOURCE_EVALUATIONS: readonly { id: string; origin: string | null }[] = [
  { id: "src-eval-null", origin: null },
  { id: "src-eval-unlisted", origin: "brand_new_origin" },
  { id: "src-eval-langy", origin: "langy" },
];
const inPeriod = (column: string) =>
  `${column} >= {dashboard_context_period_start:DateTime} ` +
  `AND ${column} < {dashboard_context_period_end:DateTime}`;
const TRACE_COUNT = `SELECT count() AS n FROM traces WHERE ${inPeriod("OccurredAt")}`;
const SPAN_COUNT = `SELECT count() AS n FROM spans WHERE ${inPeriod("StartTime")}`;
const METRIC_COUNT = `SELECT count() AS n FROM trace_metrics WHERE ${inPeriod("OccurredAt")}`;
const EVALUATION_COUNT = `SELECT count() AS n FROM evaluations WHERE ${inPeriod("ScheduledAt")}`;
const EVALUATION_METRIC_COUNT = `SELECT count() AS n FROM evaluation_metrics WHERE ${inPeriod("OccurredAt")}`;
const PRODUCTION_COUNT = `${METRIC_COUNT} AND Origin IN ('', 'application')`;
const JOINED_COUNT =
  "SELECT count() AS n FROM spans AS s INNER JOIN trace_metrics AS m ON m.TraceId = s.TraceId " +
  `WHERE ${inPeriod("s.StartTime")}`;

describe("given a project with its agent's traces and Langy's turns", () => {
  let harness: LangWatchQLClickHouseHarness;
  let service: LangWatchQLService;

  /** One statement run for the window, leaving the `leftOut` origins out when given. */
  const run = (
    sql: string,
    leftOut?: readonly string[],
    timeWindow: { start: string; end: string } = WINDOW,
  ) =>
    service.execute({
      project: { id: harness.tenantA.tenantId, lwqlKey: harness.tenantA.rawSecret },
      protections: {
        catalogue: EVERY_CATALOGUE_PERMISSION,
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      },
      sql,
      timeWindow,
      ...(leftOut ? { sources: TRACE_SOURCES.filter((source) => !leftOut.includes(source)) } : {}),
    });

  const count = async (sql: string, leftOut?: readonly string[]) =>
    Number((await run(sql, leftOut)).rows[0]?.n);

  /** One statement run on the sources day with a query's picked sources. */
  const countSources = async (sql: string, sources: readonly TraceSource[]) =>
    Number(
      (
        await service.execute({
          project: { id: harness.tenantA.tenantId, lwqlKey: harness.tenantA.rawSecret },
          protections: {
            catalogue: EVERY_CATALOGUE_PERMISSION,
            canSeeCosts: true,
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
          },
          sql,
          timeWindow: SOURCES_WINDOW,
          sources,
        })
      ).rows[0]?.n,
    );

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "originscope", facts: "migrated" });
    const { names, factDatabase: facts, tenantA } = harness;
    const views = LWQL_VIEW_CATALOG.filter((view) => VIEWS.includes(view.name));
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names,
        sourceDatabase: facts,
        views,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    await harness.applyAccessModel({ views, sourceDatabase: facts });

    const traceId = (id: string) => `${tenantA.tenantId}-origin-scope-${id}`;
    const insert = (table: string, values: Record<string, unknown>[]) =>
      harness.admin.insert({ table: `${facts}.${table}`, format: "JSONEachRow", values });
    await insert(
      "trace_summaries",
      TRACES.map(({ id }) => ({
        ProjectionId: `${tenantA.tenantId}/${traceId(id)}`,
        TenantId: tenantA.tenantId,
        TraceId: traceId(id),
        Version: "1",
        OccurredAt: AT,
        UpdatedAt: AT,
        SpanCount: SPANS_PER_TRACE,
      })),
    );
    await insert(
      "trace_analytics",
      TRACES.map(({ id, origin }) => ({
        TenantId: tenantA.tenantId,
        TraceId: traceId(id),
        Version: "1",
        OccurredAt: AT,
        CreatedAt: AT,
        UpdatedAt: AT,
        Origin: origin,
      })),
    );
    await insert(
      "stored_spans",
      TRACES.flatMap(({ id }) =>
        [...Array(SPANS_PER_TRACE).keys()].map((index) => ({
          ProjectionId: `${tenantA.tenantId}/${traceId(id)}/${index}`,
          TenantId: tenantA.tenantId,
          TraceId: traceId(id),
          SpanId: `${traceId(id)}-span-${index}`,
          Sampled: 1,
          StartTime: AT,
          EndTime: AT,
          SpanName: "llm.call",
        })),
      ),
    );

    await insert(
      "evaluation_runs",
      TRACES.map(({ id }) => ({
        ProjectionId: `${tenantA.tenantId}/${traceId(id)}/evaluation`,
        TenantId: tenantA.tenantId,
        EvaluationId: `${traceId(id)}-evaluation`,
        Version: "1",
        EvaluatorId: "quality",
        EvaluatorType: "llm_judge",
        TraceId: traceId(id),
        Status: "processed",
        ScheduledAt: AT,
        UpdatedAt: AT,
        LastProcessedEventId: "seed",
      })),
    );
    await insert(
      "evaluation_analytics",
      TRACES.map(({ id, origin }) => ({
        TenantId: tenantA.tenantId,
        EvaluationId: `${traceId(id)}-evaluation`,
        Version: "1",
        OccurredAt: AT,
        CreatedAt: AT,
        UpdatedAt: AT,
        EvaluatorType: "llm_judge",
        Status: "processed",
        TraceId: traceId(id),
        Origin: origin,
      })),
    );

    await insert(
      "trace_summaries",
      TURN_IDS.map((id) => ({
        ProjectionId: `${tenantA.tenantId}/${traceId(id)}`,
        TenantId: tenantA.tenantId,
        TraceId: traceId(id),
        Version: "1",
        OccurredAt: TURN_AT,
        UpdatedAt: TURN_AT,
        SpanCount: 1,
        TraceName: "langy.turn",
        SourceType: "gateway",
      })),
    );
    await insert(
      "trace_analytics",
      TURN_IDS.map((id) => ({
        TenantId: tenantA.tenantId,
        TraceId: traceId(id),
        Version: "1",
        OccurredAt: TURN_AT,
        CreatedAt: TURN_AT,
        UpdatedAt: TURN_AT,
        Origin: "langy",
      })),
    );

    await insert(
      "trace_summaries",
      SOURCE_TRACES.map(({ id }) => ({
        ProjectionId: `${tenantA.tenantId}/${traceId(id)}`,
        TenantId: tenantA.tenantId,
        TraceId: traceId(id),
        Version: "1",
        OccurredAt: SOURCES_AT,
        UpdatedAt: SOURCES_AT,
        SpanCount: 1,
      })),
    );
    await insert(
      "trace_analytics",
      SOURCE_TRACES.map(({ id, origin }) => ({
        TenantId: tenantA.tenantId,
        TraceId: traceId(id),
        Version: "1",
        OccurredAt: SOURCES_AT,
        CreatedAt: SOURCES_AT,
        UpdatedAt: SOURCES_AT,
        ...(origin === undefined ? {} : { Origin: origin }),
      })),
    );
    await insert(
      "evaluation_analytics",
      SOURCE_EVALUATIONS.map(({ id, origin }) => ({
        TenantId: tenantA.tenantId,
        EvaluationId: `${traceId(id)}-evaluation`,
        Version: "1",
        OccurredAt: SOURCES_AT,
        CreatedAt: SOURCES_AT,
        UpdatedAt: SOURCES_AT,
        EvaluatorType: "llm_judge",
        Status: "processed",
        TraceId: traceId(id),
        Origin: origin,
      })),
    );

    service = LangWatchQLService.create({
      executor: ClickHouseLangWatchQLExecutorRepository.create({
        connection: {
          ...harness.restrictedConnection(),
          database: names.database,
          tenantSetting: names.tenantSetting,
        },
      }),
      database: names.database,
      views,
    });
  }, 600_000);

  afterAll(async () => {
    await service?.close();
    await harness?.stop();
  });

  describe("when a statement runs with no origin left out", () => {
    /** @scenario "AC193 Sources: a run whose sources hold every origin reads every trace, Langy's included" */
    it("counts every trace, span and evaluation, Langy's included", async () => {
      expect(await count(TRACE_COUNT)).toBe(4);
      expect(await count(SPAN_COUNT)).toBe(8);
      expect(await count(EVALUATION_COUNT)).toBe(4);
      expect(await count(EVALUATION_METRIC_COUNT)).toBe(4);
      expect(await count(METRIC_COUNT, [])).toBe(4);
    });
  });

  describe("when the same statements run for a board that leaves Langy out", () => {
    /** @scenario "AC190 Sources: a run whose sources leave langy out counts none of Langy's traces or their rows" */
    it("counts only the agent's traces, and only the spans and evaluations of those", async () => {
      expect(await count(METRIC_COUNT, ["langy"])).toBe(2);
      expect(await count(TRACE_COUNT, ["langy"])).toBe(2);
      expect(await count(SPAN_COUNT, ["langy"])).toBe(4);
      expect(await count(EVALUATION_COUNT, ["langy"])).toBe(2);
      expect(await count(EVALUATION_METRIC_COUNT, ["langy"])).toBe(2);
      expect(await count(JOINED_COUNT, ["langy"])).toBe(4);
    });

    it("reports completeness over the traces the widget counted", async () => {
      const { completeness } = await run(TRACE_COUNT, ["langy"]);

      expect(completeness?.total).toBe(2);
    });

    /** @scenario "AC191 Langy: a widget's own origin filter keeps its meaning" */
    it("gives a widget that reads only production origins the rows it read before", async () => {
      const before = await count(PRODUCTION_COUNT);

      expect(before).toBe(2);
      expect(await count(PRODUCTION_COUNT, ["langy"])).toBe(before);
    });
  });

  describe("when a widget counts Langy's turns by name, which the gateway stored", () => {
    const TURNS =
      "SELECT count() AS n FROM traces WHERE TraceName = 'langy.turn' " +
      `AND ${inPeriod("OccurredAt")}`;

    /** @scenario "AC201 Widget data: a query whose sources hold langy reads Langy's turns, the gateway-stored ones included" */
    it("reads them when no origin is left out", async () => {
      const turns = await run(TURNS, undefined, TURN_WINDOW);
      const sentNone = await run(TURNS, [], TURN_WINDOW);

      expect(Number(turns.rows[0]?.n)).toBe(TURN_IDS.length);
      expect(Number(sentNone.rows[0]?.n)).toBe(TURN_IDS.length);
    });

    /** @scenario "AC201b Widget data: a query left at the default leaves Langy's turns out" */
    it("reads none of them when langy is left out", async () => {
      const turns = await run(TURNS, ["langy"], TURN_WINDOW);

      expect(Number(turns.rows[0]?.n)).toBe(0);
    });
  });

  describe("when a dashboard query names its sources", () => {
    /** @scenario "AC200l Sources: other counts every origin outside the eight known ones" */
    it("counts unstamped traces under application and an unlisted origin under other", async () => {
      expect(await countSources(METRIC_COUNT, ["application"])).toBe(3);
      expect(await countSources(TRACE_COUNT, ["application"])).toBe(3);
      expect(await countSources(METRIC_COUNT, ["other"])).toBe(1);
      expect(await countSources(TRACE_COUNT, ["other"])).toBe(1);
      expect(await countSources(METRIC_COUNT, ["application", "other"])).toBe(4);
    });

    /** @scenario "AC200b Sources: a query saved with picked sources counts only traces of those origins" */
    it("counts one trace for each listed origin but application, and all of them together", async () => {
      for (const origin of KNOWN_TRACE_ORIGINS.filter((o) => o !== "application")) {
        expect({ origin, n: await countSources(METRIC_COUNT, [origin]) }).toEqual({ origin, n: 1 });
      }
      expect(await countSources(METRIC_COUNT, [...KNOWN_TRACE_ORIGINS, "other"])).toBe(
        SOURCE_TRACES.length,
      );
    });

    /** @scenario "AC200l Sources: other counts every origin outside the eight known ones" */
    it("counts an evaluation whose origin is NULL under application", async () => {
      expect(await countSources(EVALUATION_METRIC_COUNT, ["application"])).toBe(1);
      expect(await countSources(EVALUATION_METRIC_COUNT, ["other"])).toBe(1);
      expect(await countSources(EVALUATION_METRIC_COUNT, ["langy"])).toBe(1);
    });

    /** @scenario "AC200m Sources: a query with no source picked counts nothing and says so" */
    it("counts nothing when no source is picked", async () => {
      expect(await countSources(METRIC_COUNT, [])).toBe(0);
      expect(await countSources(TRACE_COUNT, [])).toBe(0);
    });
  });
});
