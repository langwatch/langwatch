import { describe, expect, it } from "vitest";
import {
  DashboardGraphVisibilityPolicyPort,
  DashboardIdGenerator,
  PostgresDashboardAdapter,
} from "@langwatch/dashboard-server";
import { recordingExecutor } from "~/server/analytics/lwql/executor.testFakes";
import { LangWatchQLService } from "~/server/analytics/lwql/lwql.service";
import { AppSavedWorkbenchChartPolicy } from "../dashboard-saved-workbench-chart-policy.adapter";

const PROJECT = { id: "project_1", lwqlKey: "restricted-project-key" };
const WEEK = {
  start: new Date("2026-02-01T00:00:00.000Z"),
  end: new Date("2026-02-08T00:00:00.000Z"),
};
const TIMESERIES_SQL =
  "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
  "count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
  "GROUP BY bucket";

/** The runner every case here is measured for: nothing content-gated is hidden. */
const FULLY_PERMITTED = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  canSeeCosts: true,
};

class TestDashboardIds extends DashboardIdGenerator {
  generate(): string {
    return "dashboard_test";
  }
}

class UnusedGraphVisibility extends DashboardGraphVisibilityPolicyPort {
  async placeableKinds(): Promise<readonly ("builder" | "workbench_sql")[]> {
    return ["builder"];
  }
}

function serviceWithSavedChart() {
  const executor = recordingExecutor();
  const langWatchQL = new LangWatchQLService({ executor, database: "analytics" });
  const chart = {
    id: "chart_1",
    projectId: PROJECT.id,
    name: "Traces over time",
    graph: { version: 1, sql: TIMESERIES_SQL, parameters: {} },
    dashboardId: "dashboard_1",
    gridColumn: 0,
    gridRow: 0,
    colSpan: 1,
    rowSpan: 1,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
  };
  const dashboard = PostgresDashboardAdapter.create({
    database: { customGraph: { findFirst: async () => chart } },
    ids: new TestDashboardIds(),
    savedWorkbenchChartPolicy: AppSavedWorkbenchChartPolicy.create({ langWatchQL }),
    graphVisibility: new UnusedGraphVisibility(),
    langWatchQL,
  }).build();

  return { dashboard, executor };
}

describe("Dashboard saved-chart execution", () => {
  /** @scenario "Running a saved chart executes its stored statement with its saved values and the surface's window and step" */
  it("runs the stored statement through restricted LangWatchQL with dashboard coarsening", async () => {
    const { dashboard, executor } = serviceWithSavedChart();

    const result = await dashboard.runSavedWorkbenchChart({
      projectId: PROJECT.id,
      chartId: "chart_1",
      execution: {
        project: PROJECT,
        protections: FULLY_PERMITTED,
        timeWindow: WEEK,
        granularitySeconds: 60,
        onBudgetOverflow: "coarsen",
      },
    });

    expect(result).toMatchObject({ granularitySeconds: 3_600, coarsenedFromSeconds: 60 });
    expect(executor.calls).toHaveLength(1);
    expect(executor.calls[0]!.sql).toContain("FROM analytics.traces");
    expect(executor.calls[0]!.parameters).toMatchObject({
      period_granularity_seconds: 3_600,
      period_start: "2026-02-01 00:00:00",
      period_end: "2026-02-08 00:00:00",
    });
  });

  /**
   * A direct chart run is caller-owned, so it refuses where a dashboard widget
   * passes `onBudgetOverflow: "coarsen"` and reads `coarsenedFromSeconds` off
   * the result instead. Refusing is the default: nothing has to ask for it.
   */
  /** @scenario "Running a saved chart refuses a step finer than the period's bucket budget" */
  it("refuses a step finer than the period's bucket budget when nothing asked to coarsen", async () => {
    const { dashboard, executor } = serviceWithSavedChart();

    await expect(
      dashboard.runSavedWorkbenchChart({
        projectId: PROJECT.id,
        chartId: "chart_1",
        execution: {
          project: PROJECT,
          protections: FULLY_PERMITTED,
          timeWindow: WEEK,
          granularitySeconds: 60,
        },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "lwql_granularity_too_fine" }));

    expect(executor.calls).toHaveLength(0);
  });

  it("refuses identically when the caller asks for it, rather than only by default", async () => {
    const { dashboard } = serviceWithSavedChart();

    await expect(
      dashboard.runSavedWorkbenchChart({
        projectId: PROJECT.id,
        chartId: "chart_1",
        execution: {
          project: PROJECT,
          protections: FULLY_PERMITTED,
          timeWindow: WEEK,
          granularitySeconds: 60,
          onBudgetOverflow: "refuse",
        },
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: "lwql_granularity_too_fine" }));
  });

  it("reports no coarsening for a period that fits, even when offered", async () => {
    const { dashboard } = serviceWithSavedChart();

    // An hour over a week is 168 buckets. It fits, so nothing is substituted
    // and the widget has no notice to show.
    const result = await dashboard.runSavedWorkbenchChart({
      projectId: PROJECT.id,
      chartId: "chart_1",
      execution: {
        project: PROJECT,
        protections: FULLY_PERMITTED,
        timeWindow: WEEK,
        granularitySeconds: 3_600,
        onBudgetOverflow: "coarsen",
      },
    });

    expect(result.granularitySeconds).toBe(3_600);
    expect(result.coarsenedFromSeconds).toBeUndefined();
  });
});
