/**
 * What a saved workbench chart actually is once Postgres holds it.
 *
 * The unit suites drive the service against an in-memory repository, so they
 * prove the orchestration and nothing about the row. These claims are the
 * other half: a definition survives a round trip through a `Json` column, the
 * two chart kinds share one table without becoming readable as each other, and
 * every read and write is fenced to the project that asked.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 * @see specs/analytics/lwql-langy-authoring.feature
 */

import {
  LangWatchQLService,
  type LangWatchQLExecuteInput,
  type LangWatchQLQueryResult,
  type LangWatchQLSchema,
  type LangWatchQLValidationInput,
} from "@langwatch/analytics-contract";
import {
  GraphNotFoundError,
  SavedWorkbenchChartDashboardNotFoundError,
  SavedWorkbenchChartNotFoundError,
} from "@langwatch/dashboard-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DashboardGraphVisibilityPolicyPort,
  DashboardIdGenerator,
  SavedWorkbenchChartPolicy,
} from "../../../ports/dashboard.port";
import { PrismaDashboardRepository } from "../prisma.dashboard.repository";
import { DashboardService } from "../../../services/dashboard.service";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

class TestDashboardIds extends DashboardIdGenerator {
  generate(): string {
    return `saved-chart-${randomUUID()}`;
  }
}

/** Governance is the application's; this suite is about the row. */
class AllowSavedWorkbenchCharts extends SavedWorkbenchChartPolicy {
  validate(): void {}
}

class AllGraphsVisible extends DashboardGraphVisibilityPolicyPort {
  async placeableKinds(): Promise<readonly ("builder" | "workbench_sql")[]> {
    return ["builder", "workbench_sql"];
  }
}

class UnusedLangWatchQL extends LangWatchQLService {
  readonly available = false;

  async close(): Promise<void> {}

  describeSchema(): LangWatchQLSchema {
    return { database: "analytics", datasets: [] };
  }

  validate(_input: LangWatchQLValidationInput): unknown {
    return {};
  }

  async execute(_input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult> {
    throw new Error("This persistence suite does not execute LangWatchQL");
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for saved workbench chart persistence tests");
  }
  return connection.client;
}

const namespace = `saved-chart-${randomUUID()}`;
let organizationId = "";
let teamId = "";
/** The project every claim is made for. */
let projectId = "";
/** A second tenant, so "not yours" is a real row rather than a missing one. */
let otherProjectId = "";

function service(): DashboardService {
  return DashboardService.create({
    repository: PrismaDashboardRepository.create(database()),
    ids: new TestDashboardIds(),
    savedWorkbenchChartPolicy: new AllowSavedWorkbenchCharts(),
    graphVisibility: new AllGraphsVisible(),
    langWatchQL: new UnusedLangWatchQL(),
  });
}

const SPECIFICATION = {
  $schema: "https://vega.github.io/schema/vega-lite/v6.json",
  data: { name: "query_result" },
  mark: "bar",
};

const DEFINITION = {
  version: 1 as const,
  sql: "SELECT count() AS value FROM analytics.traces WHERE OccurredAt >= {since:DateTime}",
  parameters: { since: "2026-02-01 00:00:00" },
  vegaLiteSpec: SPECIFICATION,
};

async function createProject(slug: string): Promise<string> {
  const project = await database().project.create({
    data: {
      name: slug,
      slug,
      apiKey: slug,
      teamId,
      language: "typescript",
      framework: "other",
    },
    select: { id: true },
  });
  return project.id;
}

async function createDashboard(forProjectId = projectId): Promise<{ id: string }> {
  return database().dashboard.create({
    data: {
      id: `dashboard-${randomUUID()}`,
      projectId: forProjectId,
      name: "Reports",
      order: 0,
    },
    select: { id: true },
  });
}

async function saveChart(
  overrides: { projectId?: string; name?: string } = {},
): Promise<{ id: string }> {
  return service().createSavedWorkbenchChart({
    projectId: overrides.projectId ?? projectId,
    protections: {},
    name: overrides.name ?? "Traces over time",
    definition: DEFINITION,
  });
}

describe.skipIf(!databaseUrl)("Saved workbench chart persistence", () => {
  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
    projectId = await createProject(namespace);
    otherProjectId = await createProject(`${namespace}-other`);
  });

  beforeEach(async () => {
    await cleanupTestRows(database(), [
      ["customGraph", { projectId: { in: [projectId, otherProjectId] } }],
      ["dashboard", { projectId: { in: [projectId, otherProjectId] } }],
    ]);
  });

  afterAll(async () => {
    try {
      if (projectId) {
        await cleanupTestRows(database(), [
          ["customGraph", { projectId: { in: [projectId, otherProjectId] } }],
          ["dashboard", { projectId: { in: [projectId, otherProjectId] } }],
          ["project", { id: { in: [projectId, otherProjectId] } }],
        ]);
        await database().team.delete({ where: { id: teamId } });
        await database().organization.delete({ where: { id: organizationId } });
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  describe("given a chart that has been saved", () => {
    /** @scenario "A saved chart reads back with its SQL, parameters and specification intact" */
    it("reads back the query, its parameter values and its specification unchanged", async () => {
      const saved = await saveChart();

      const read = await service().getSavedWorkbenchChart({ projectId, chartId: saved.id });

      expect(read.definition).toEqual(DEFINITION);
      expect(read.name).toBe("Traces over time");
      expect(read.dashboardId).toBeNull();
    });

    /** @scenario "A saved chart is listed among the project's workbench charts" */
    it("is listed among the project's workbench charts", async () => {
      const first = await saveChart({ name: "First" });
      const second = await saveChart({ name: "Second" });

      const listed = await service().listSavedWorkbenchCharts({ projectId });

      expect(listed.map((chart) => chart.id).sort()).toEqual([first.id, second.id].sort());
    });
  });

  describe("given both chart kinds sharing the one grid table", () => {
    /** @scenario "A builder chart is not readable as a workbench chart" */
    /** @scenario "Builder and workbench rows remain isolated" */
    it("does not answer a workbench read with a builder row", async () => {
      const builder = await service().createGraph({
        projectId,
        name: "Builder",
        graph: {},
      });

      await expect(
        service().getSavedWorkbenchChart({ projectId, chartId: builder.id }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      await expect(service().listSavedWorkbenchCharts({ projectId })).resolves.toEqual([]);
    });

    /** @scenario "A saved workbench chart is not readable as a builder chart" */
    /** @scenario "Builder and workbench rows remain isolated" */
    it("does not answer a builder read with a workbench row", async () => {
      const saved = await saveChart();

      await expect(service().getGraph({ projectId, graphId: saved.id })).rejects.toBeInstanceOf(
        GraphNotFoundError,
      );
      await expect(service().listGraphs({ projectId })).resolves.toEqual([]);
    });
  });

  describe("given a chart belonging to another project", () => {
    /** @scenario "Another project's saved charts are not listed" */
    it("keeps it out of this project's listing", async () => {
      const mine = await saveChart({ name: "Mine" });
      await saveChart({ projectId: otherProjectId, name: "Theirs" });

      const listed = await service().listSavedWorkbenchCharts({ projectId });

      expect(listed.map((chart) => chart.id)).toEqual([mine.id]);
    });

    /** @scenario "Another project's saved chart is not readable" */
    it("answers exactly as it would for an id that never existed", async () => {
      const saved = await saveChart();

      await expect(
        service().getSavedWorkbenchChart({ projectId: otherProjectId, chartId: saved.id }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      await expect(
        service().getSavedWorkbenchChart({
          projectId: otherProjectId,
          chartId: `never-${randomUUID()}`,
        }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
    });

    /** @scenario "Another project's saved chart cannot be edited or deleted" */
    it("refuses both as not found and leaves the chart exactly as it was", async () => {
      const saved = await saveChart();

      await expect(
        service().updateSavedWorkbenchChart({
          projectId: otherProjectId,
          chartId: saved.id,
          name: "Renamed by a stranger",
        }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);
      await expect(
        service().deleteSavedWorkbenchChart({ projectId: otherProjectId, chartId: saved.id }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartNotFoundError);

      const after = await service().getSavedWorkbenchChart({ projectId, chartId: saved.id });
      expect(after.name).toBe("Traces over time");
      expect(after.definition).toEqual(DEFINITION);
    });
  });

  describe("given a chart being placed on a dashboard", () => {
    /** @scenario "A placed chart round-trips with the dashboard id and grid position it was given" */
    it("reads back with the dashboard and the grid position it was given", async () => {
      const dashboard = await createDashboard();
      const saved = await saveChart();

      await service().placeSavedWorkbenchChart({
        projectId,
        chartId: saved.id,
        dashboardId: dashboard.id,
        gridColumn: 1,
        gridRow: 3,
        colSpan: 1,
        rowSpan: 2,
      });

      await expect(
        service().getSavedWorkbenchChart({ projectId, chartId: saved.id }),
      ).resolves.toMatchObject({
        dashboardId: dashboard.id,
        gridColumn: 1,
        gridRow: 3,
        colSpan: 1,
        rowSpan: 2,
      });
    });

    /** @scenario "Placing a chart onto another project's dashboard is refused, and nothing is written" */
    it("refuses another project's dashboard and leaves the chart unplaced", async () => {
      const foreignDashboard = await createDashboard(otherProjectId);
      const saved = await saveChart();

      await expect(
        service().placeSavedWorkbenchChart({
          projectId,
          chartId: saved.id,
          dashboardId: foreignDashboard.id,
        }),
      ).rejects.toBeInstanceOf(SavedWorkbenchChartDashboardNotFoundError);

      await expect(
        service().getSavedWorkbenchChart({ projectId, chartId: saved.id }),
      ).resolves.toMatchObject({ dashboardId: null, gridColumn: 0, gridRow: 0 });
    });
  });

  describe("given a chart being taken off a dashboard", () => {
    /** @scenario "Unplacing a chart clears every placement field, not just the dashboard id" */
    it("returns every grid field to its unplaced default, not only the dashboard id", async () => {
      const dashboard = await createDashboard();
      const saved = await saveChart();
      await service().placeSavedWorkbenchChart({
        projectId,
        chartId: saved.id,
        dashboardId: dashboard.id,
        gridColumn: 1,
        gridRow: 7,
        colSpan: 1,
        rowSpan: 2,
      });

      await service().unplaceSavedWorkbenchChart({ projectId, chartId: saved.id });

      await expect(
        service().getSavedWorkbenchChart({ projectId, chartId: saved.id }),
      ).resolves.toMatchObject({
        dashboardId: null,
        gridColumn: 0,
        gridRow: 0,
        colSpan: 1,
        rowSpan: 1,
      });
    });
  });

  describe("given a placed chart being deleted", () => {
    /** @scenario "Deleting a placed chart leaves no dangling reference on its dashboard" */
    it("removes the row rather than leaving the dashboard pointing at it", async () => {
      const dashboard = await createDashboard();
      const saved = await saveChart();
      await service().placeSavedWorkbenchChart({
        projectId,
        chartId: saved.id,
        dashboardId: dashboard.id,
      });

      await service().deleteSavedWorkbenchChart({ projectId, chartId: saved.id });

      await expect(
        database().customGraph.findUnique({ where: { id: saved.id } }),
      ).resolves.toBeNull();
      await expect(
        service().getById({ projectId, dashboardId: dashboard.id }),
      ).resolves.toMatchObject({ graphs: [] });
    });
  });
});
