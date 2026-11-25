/**
 * @vitest-environment node
 * A dated widget read whose trace_metrics__floor twin is missing (a rolling deploy) answers
 * as written, with the whole-history rows, instead of refusing. Own suite database, so
 * dropping the twin touches no other suite.
 * @see specs/lwql/dedup-floor.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { LangWatchQLQueryResult } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ADMIT_EVERY_PLACEMENT,
  TEST_RUN_TELEMETRY,
} from "../../app/__tests__/analytics.fixture.ts";
import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { ClickHouseLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-executor.repository.ts";
import {
  LangWatchQLExecutorRepository,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { flooredViewName } from "../../rules/lwql-dedup-floor.rules.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { EVERY_CATALOGUE_PERMISSION } from "../../services/__tests__/lwql-catalogue-access.fixture.ts";
import type { LangWatchQLViewDefinition } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { LangWatchQLService } from "../../services/langwatch-ql.service.ts";
import {
  type LangWatchQLClickHouseHarness,
  startLangWatchQLClickHouse,
  TENANT_A,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();
const VIEWS = LWQL_VIEW_CATALOG.filter((view) => view.name === "trace_metrics");
const TWIN = flooredViewName("trace_metrics");

/** The stock spend widget: trace_metrics bounded to the board's period, bucketed by day. */
const SPEND = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
      "utf8",
    ),
  ) as { label: string; sql: string }[]
).find((query) => query.label === "spend/main")?.sql;

const TENANT = TENANT_A.tenantId;
const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;
const WINDOW = {
  start: new Date(PERIOD_START).toISOString(),
  end: new Date(PERIOD_END).toISOString(),
};
const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");

/** Versions of each trace, oldest first: a superseded cost, one before the period, plain ones. */
const VERSIONS: { trace: string; day: number; version: number; cost: number }[] = [
  { trace: "floor-missing-1", day: 1, version: 1, cost: 0.5 },
  { trace: "floor-missing-1", day: 1, version: 2, cost: 0.75 },
  { trace: "floor-missing-2", day: 3, version: 1, cost: 1 },
  { trace: "floor-missing-3", day: 5, version: 1, cost: 0.25 },
  { trace: "floor-missing-before", day: -2, version: 1, cost: 2 },
];

/** The same view with no floor column, so the service sends every read of it as written. */
function unfloored(view: LangWatchQLViewDefinition): LangWatchQLViewDefinition {
  const { floorColumn, ...dedup } = view.dedup;
  return floorColumn === undefined ? view : { ...view, dedup };
}

/** The shipped executor, keeping each request it was handed. */
class RecordingExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly executor: LangWatchQLExecutorRepository) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);
    return this.executor.execute(request);
  }
}

describe("given a dated trace_metrics widget read through the shipped executor", () => {
  let harness: LangWatchQLClickHouseHarness;
  let shipped: ClickHouseLangWatchQLExecutorRepository;

  async function read({ views }: { views: readonly LangWatchQLViewDefinition[] }): Promise<{
    result: LangWatchQLQueryResult;
    sent: readonly string[];
    requests: readonly LangWatchQLExecutionRequest[];
  }> {
    if (!SPEND) throw new Error("no spend/main stock query");
    const executor = new RecordingExecutor(shipped);
    const service = LangWatchQLService.create({
      runTelemetry: TEST_RUN_TELEMETRY,
      placement: ADMIT_EVERY_PLACEMENT,
      executor,
      database: harness.names.database,
      views,
    });
    const result = await service.executeForProjects({
      projects: [{ id: TENANT, lwqlKey: TENANT_A.rawSecret }],
      protections: {
        catalogue: EVERY_CATALOGUE_PERMISSION,
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      },
      sql: SPEND,
      timeWindow: WINDOW,
      granularitySeconds: 86_400,
    });
    const { requests } = executor;
    return { result, sent: requests.map((request) => request.sql), requests };
  }

  /** The rows and completeness total of the read sent as written, from the whole-history view. */
  async function asWritten() {
    const { result, sent } = await read({ views: VIEWS.map(unfloored) });
    expect(sent.join("\n")).not.toContain("__floor");
    expect(result.completeness?.total).toBeGreaterThan(0);
    return { rows: result.rows, total: result.completeness?.total };
  }

  beforeAll(async () => {
    harness = await startLangWatchQLClickHouse({ suite: "floor_twin_missing", facts: "migrated" });
    const { names, factDatabase: facts } = harness;
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({
        names,
        sourceDatabase: facts,
        views: VIEWS,
        dedup: SHIPPED_LWQL_DEDUP,
      }),
    );
    await harness.applyAccessModel({ views: VIEWS, sourceDatabase: facts });
    for (const { trace, day, version, cost } of VERSIONS) {
      await harness.admin.insert({
        table: `${facts}.trace_analytics`,
        format: "JSONEachRow",
        values: [
          {
            TenantId: TENANT,
            TraceId: trace,
            Version: String(version),
            OccurredAt: at(PERIOD_START + day * DAY),
            CreatedAt: at(PERIOD_START + day * DAY),
            UpdatedAt: at(PERIOD_START + day * DAY + version * 60_000),
            TraceName: trace,
            Origin: "application",
            Models: ["gpt-5"],
            TotalCost: cost,
            TotalDurationMs: 1200,
            HasError: false,
          },
        ],
      });
    }
    shipped = ClickHouseLangWatchQLExecutorRepository.create({
      connection: {
        ...harness.restrictedConnection(),
        database: names.database,
        tenantSetting: names.tenantSetting,
      },
    });
  }, 600_000);

  afterAll(async () => {
    await shipped?.close();
    await harness?.stop();
  });

  describe("when the floored twin is provisioned", () => {
    /** @scenario "A dated widget read on a deployment missing its floored twin answers as written" */
    it("reads the twin and its completeness report from it, with the rows as written", async () => {
      const expected = await asWritten();

      const { result, sent } = await read({ views: VIEWS });

      expect(result.rows.length).toBeGreaterThan(0);
      expect(sent).toHaveLength(2);
      expect(sent[0]).toContain(`${TWIN}(`);
      expect(sent[1]).toContain(`${TWIN}(`);
      expect(result.rows).toEqual(expected.rows);
      expect(result.completeness?.total).toBe(expected.total);
    });
  });

  describe("when the floored twin was never provisioned", () => {
    beforeAll(async () => {
      await harness.applyAsAdmin([`DROP VIEW IF EXISTS ${harness.names.database}.${TWIN}`]);
    });

    /** @scenario "A dated widget read on a deployment missing its floored twin answers as written" */
    it("sends the read and its report as written after the twin is refused, with the same rows", async () => {
      const expected = await asWritten();

      const { result, sent } = await read({ views: VIEWS });

      expect(result.rows.length).toBeGreaterThan(0);
      expect(sent).toHaveLength(4);
      expect([sent[0], sent[2]].every((sql) => sql?.includes(`${TWIN}(`))).toBe(true);
      expect([sent[1], sent[3]].some((sql) => sql?.includes("__floor"))).toBe(false);
      expect(result.rows).toEqual(expected.rows);
      expect(result.completeness?.total).toBe(expected.total);
    });

    /** @scenario "A dated widget read on a deployment missing its floored twin answers as written" */
    it("refuses the floored read as lwql_unavailable over ClickHouse's UNKNOWN_FUNCTION", async () => {
      const { requests } = await read({ views: VIEWS });
      const [floored] = requests;
      expect(floored?.sql).toContain(`${TWIN}(`);
      if (!floored) throw new Error("no floored request");

      const refusal = await shipped.execute(floored).then(
        () => undefined,
        (error: unknown) => error as { code?: string; reasons?: readonly unknown[] },
      );

      expect(refusal?.code).toBe("lwql_unavailable");
      expect(refusal?.reasons?.[0]).toMatchObject({ code: "46", type: "UNKNOWN_FUNCTION" });
    });
  });
});
