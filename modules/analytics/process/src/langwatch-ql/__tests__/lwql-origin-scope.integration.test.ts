/**
 * The origin scope read by a real ClickHouse as the restricted identity, over the shipped
 * migrations and views: a run that leaves Langy out counts none of Langy's traces or their rows.
 * @see modules/analytics/adrs/003-lwql-origin-scope.md
 * @vitest-environment node
 */
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

  /** One statement run for the board's window, leaving `excludeOrigins` out when given. */
  const run = (sql: string, excludeOrigins?: readonly string[]) =>
    service.execute({
      project: { id: harness.tenantA.tenantId, lwqlKey: harness.tenantA.rawSecret },
      protections: {
        catalogue: EVERY_CATALOGUE_PERMISSION,
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      },
      sql,
      timeWindow: WINDOW,
      ...(excludeOrigins ? { excludeOrigins } : {}),
    });

  const count = async (sql: string, excludeOrigins?: readonly string[]) =>
    Number((await run(sql, excludeOrigins)).rows[0]?.n);

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
    /** @scenario "AC193 Langy: the origins a board leaves out are a list a board parameter can set later" */
    it("counts every trace, span and evaluation, Langy's included", async () => {
      expect(await count(TRACE_COUNT)).toBe(4);
      expect(await count(SPAN_COUNT)).toBe(8);
      expect(await count(EVALUATION_COUNT)).toBe(4);
      expect(await count(EVALUATION_METRIC_COUNT)).toBe(4);
      expect(await count(METRIC_COUNT, [])).toBe(4);
    });
  });

  describe("when the same statements run for a board that leaves Langy out", () => {
    /** @scenario "AC190 Langy: every widget on a board leaves out Langy's conversations by default" */
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
});
