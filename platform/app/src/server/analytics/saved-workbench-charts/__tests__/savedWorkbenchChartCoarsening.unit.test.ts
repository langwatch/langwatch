/**
 * The overflow mode a chart run is executed under, and who gets which.
 *
 * The arithmetic of coarsening is proven in `lwqlGranularity.unit.test.ts`
 * against `resolveLangWatchQLGranularity` directly. What is unproven until here
 * is the *wiring*: that a caller asking to coarsen actually reaches that branch
 * through the saved-chart service, and — the claim that matters more — that a
 * caller who says nothing still refuses. A default that silently flipped to
 * coarsening would widen every workbench and REST run's buckets without any
 * caller asking, and every existing test would still pass because they all
 * assert on results that fit the budget.
 *
 * The executor is a recording fake: the claim is "what reached the database",
 * which is an artifact to read rather than a call sequence to verify.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see specs/analytics/lwql-workbench.feature
 */

import { describe, expect, it } from "vitest";
import type { CustomGraph } from "~/generated/prisma/client";

import type { Protections } from "../../../traces/protections";
import { WORKBENCH_SQL_CHART_KIND } from "../../chartKinds";
import { recordingExecutor } from "../../lwql/executor.testFakes";
import { LangWatchQLService } from "../../lwql/lwql.service";
import type {
  CreateSavedWorkbenchChartInput,
  SavedWorkbenchChartStore,
  UpdateSavedWorkbenchChartInput,
} from "../savedWorkbenchChart.repository";
import { SavedWorkbenchChartService } from "../savedWorkbenchChart.service";
import { WORKBENCH_CHART_DEFINITION_VERSION } from "../workbenchChartDefinition";

const PROJECT_ID = "project-under-test";
const CHART_ID = "chart-under-test";

const FULLY_PERMITTED: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

/**
 * A statement that follows both the period and the granularity, which is what
 * makes it subject to the bucket budget at all.
 */
const TIMESERIES_SQL =
  "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
  "count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
  "GROUP BY bucket";

/**
 * A week. At one-minute steps that is 10,080 buckets — just past the 10,000
 * ceiling, and an ordinary pairing rather than a contrived one.
 */
const WEEK = {
  start: new Date("2026-02-01T00:00:00.000Z"),
  end: new Date("2026-02-08T00:00:00.000Z"),
};

class FakeStore implements SavedWorkbenchChartStore {
  readonly rows = new Map<string, CustomGraph>();

  seed(definition: unknown): void {
    this.rows.set(CHART_ID, {
      id: CHART_ID,
      projectId: PROJECT_ID,
      name: "Traces over time",
      graph: definition,
      filters: null,
      kind: WORKBENCH_SQL_CHART_KIND,
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      dashboardId: "dashboard-1",
      gridColumn: 0,
      gridRow: 0,
      colSpan: 1,
      rowSpan: 1,
    } as CustomGraph);
  }

  async findAll({ projectId }: { projectId: string }): Promise<CustomGraph[]> {
    return [...this.rows.values()].filter((row) => row.projectId === projectId);
  }

  async findById({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    const row = this.rows.get(id);
    return row && row.projectId === projectId ? row : null;
  }

  async create(_input: CreateSavedWorkbenchChartInput): Promise<CustomGraph> {
    throw new Error("not used by this suite");
  }

  async update(
    _input: UpdateSavedWorkbenchChartInput,
  ): Promise<CustomGraph | null> {
    throw new Error("not used by this suite");
  }

  async delete(_input: { id: string; projectId: string }): Promise<number> {
    throw new Error("not used by this suite");
  }

  async place(_input: {
    id: string;
    projectId: string;
    dashboardId: string;
    gridColumn: number;
    gridRow: number;
    colSpan: number;
    rowSpan: number;
  }): Promise<CustomGraph | null> {
    throw new Error("not used by this suite");
  }

  async unplace(_input: {
    id: string;
    projectId: string;
  }): Promise<CustomGraph | null> {
    throw new Error("not used by this suite");
  }
}

function build() {
  const store = new FakeStore();
  store.seed({
    version: WORKBENCH_CHART_DEFINITION_VERSION,
    sql: TIMESERIES_SQL,
    parameters: {},
  });
  const executor = recordingExecutor();
  const service = new SavedWorkbenchChartService({
    repository: store,
    lwql: new LangWatchQLService({ executor, database: "analytics" }),
    // Placement is not exercised by this suite; the answers are inert.
    dashboardBelongsToProject: async () => false,
    allocateNextGridRow: async () => 0,
  });
  return { store, service, executor };
}

const runWith = async (
  input: Parameters<SavedWorkbenchChartService["runChart"]>[0]["input"],
) => {
  const { service, executor } = build();
  const result = await service.runChart({
    id: CHART_ID,
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID, lwqlKey: "key" },
    protections: FULLY_PERMITTED,
    input,
  });
  return { result, executor };
};

describe("running a saved chart whose period overflows its step", () => {
  describe("when the caller asks to coarsen, as a dashboard widget does", () => {
    it("runs at the finest step that fits and names what it substituted", async () => {
      const { result, executor } = await runWith({
        timeWindow: WEEK,
        granularitySeconds: 60,
        onBudgetOverflow: "coarsen",
      });

      // A week at a minute is 10,080 buckets; the hour is the finest offered
      // step that fits.
      expect(result.granularitySeconds).toBe(3600);
      expect(result.coarsenedFromSeconds).toBe(60);

      // The substitution is not merely reported — it is what actually ran.
      expect(executor.calls).toHaveLength(1);
      expect(executor.calls[0]?.parameters).toMatchObject({
        period_granularity_seconds: 3600,
      });
    });
  });

  describe("when the caller says nothing about overflow", () => {
    it("refuses rather than quietly widening the buckets", async () => {
      await expect(
        runWith({ timeWindow: WEEK, granularitySeconds: 60 }),
      ).rejects.toMatchObject({ code: "lwql_granularity_too_fine" });
    });

    it("never reaches the database", async () => {
      const { service, executor } = build();

      await expect(
        service.runChart({
          id: CHART_ID,
          projectId: PROJECT_ID,
          project: { id: PROJECT_ID, lwqlKey: "key" },
          protections: FULLY_PERMITTED,
          input: { timeWindow: WEEK, granularitySeconds: 60 },
        }),
      ).rejects.toThrow();

      expect(executor.calls).toEqual([]);
    });
  });

  describe("when the caller explicitly asks to refuse", () => {
    it("refuses, the same as saying nothing", async () => {
      await expect(
        runWith({
          timeWindow: WEEK,
          granularitySeconds: 60,
          onBudgetOverflow: "refuse",
        }),
      ).rejects.toMatchObject({ code: "lwql_granularity_too_fine" });
    });
  });
});

describe("running a saved chart whose period fits its step", () => {
  it("reports no coarsening even when the caller offered to coarsen", async () => {
    // An hour over a week: 168 buckets. Fits, so nothing is substituted and
    // the widget has no notice to show.
    const { result } = await runWith({
      timeWindow: WEEK,
      granularitySeconds: 3600,
      onBudgetOverflow: "coarsen",
    });

    expect(result.granularitySeconds).toBe(3600);
    expect(result.coarsenedFromSeconds).toBeUndefined();
  });
});
