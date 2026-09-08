/**
 * @vitest-environment node
 * The dashboard, builder graph and saved workbench chart contract, stated once
 * and run against both backends: the memory twin always, and the Postgres one
 * when a test database is named at `LANGWATCH_TEST_DATABASE_URL`.
 * @see specs/dashboard-service.feature
 */
import type { SavedWorkbenchChartDefinition } from "@langwatch/dashboard-contract";
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

import type { DashboardRepository } from "../dashboard.repository.ts";
import { MemoryDashboardRepository } from "../memory/memory.dashboard.repository.ts";
import { PrismaDashboardRepository } from "../prisma/prisma.dashboard.repository.ts";

/** One backend under test, plus the two projects the isolation cases read. */
type Backend = Readonly<{
  repository: () => DashboardRepository;
  projectId: () => string;
  otherProjectId: () => string;
}>;

const LAYOUT = { gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 };
const BOTH_KINDS = ["builder", "workbench_sql"] as const;
const DEFINITION: SavedWorkbenchChartDefinition = {
  version: 1,
  sql: "SELECT 1",
  parameters: {},
};

const id = (prefix: string) => `${prefix}_${randomUUID()}`;

function contractCases(backend: Backend): void {
  const dashboard = async (name = "Reports", order = 0) =>
    await backend
      .repository()
      .createDashboard({ id: id("dash"), projectId: backend.projectId(), name, order });

  const graph = async (dashboardId: string | null, name = "Latency", layout = LAYOUT) =>
    await backend.repository().createGraph({
      id: id("graph"),
      projectId: backend.projectId(),
      name,
      graph: { type: "line" },
      filters: {},
      dashboardId,
      layout,
    });

  const chart = async (name = "Spend") =>
    await backend.repository().createSavedWorkbenchChart({
      id: id("chart"),
      projectId: backend.projectId(),
      name,
      definition: DEFINITION,
    });

  describe("when the project holds nothing", () => {
    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("answers every dashboard read with absence rather than a refusal", async () => {
      const repository = backend.repository();

      await expect(
        repository.findAllDashboards({ projectId: backend.projectId(), graphKinds: BOTH_KINDS }),
      ).resolves.toEqual([]);
      await expect(
        repository.findDashboard({ projectId: backend.projectId(), dashboardId: "dash_absent" }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findFirstDashboard({ projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findLastDashboard({ projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findDashboardIds({
          projectId: backend.projectId(),
          dashboardIds: ["dash_absent"],
        }),
      ).resolves.toEqual([]);
    });

    it("answers every chart read with absence rather than a refusal", async () => {
      const repository = backend.repository();

      await expect(repository.findAllGraphs({ projectId: backend.projectId() })).resolves.toEqual(
        [],
      );
      await expect(
        repository.findGraph({ projectId: backend.projectId(), graphId: "graph_absent" }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findLastGraphGridRow({
          projectId: backend.projectId(),
          dashboardId: "dash_absent",
        }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findAllSavedWorkbenchCharts({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
      await expect(
        repository.findSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: "chart_absent",
        }),
      ).resolves.toBeUndefined();
    });

    it("refuses a dashboard write that names a row it does not hold", async () => {
      const repository = backend.repository();

      await expect(
        repository.updateDashboard({
          projectId: backend.projectId(),
          dashboardId: "dash_absent",
          data: { name: "Renamed" },
        }),
      ).rejects.toThrow();
      await expect(
        repository.deleteDashboard({
          projectId: backend.projectId(),
          dashboardId: "dash_absent",
        }),
      ).rejects.toThrow();
      await expect(
        repository.updateDashboardOrder({
          projectId: backend.projectId(),
          dashboardIds: ["dash_absent"],
        }),
      ).rejects.toThrow();
    });

    it("refuses a graph write that names a row it does not hold", async () => {
      const repository = backend.repository();

      await expect(
        repository.updateGraph({
          projectId: backend.projectId(),
          graphId: "graph_absent",
          name: "Renamed",
        }),
      ).rejects.toThrow();
      await expect(
        repository.deleteGraph({ projectId: backend.projectId(), graphId: "graph_absent" }),
      ).rejects.toThrow();
      await expect(
        repository.updateGraphLayout({
          projectId: backend.projectId(),
          graphId: "graph_absent",
          layout: LAYOUT,
        }),
      ).rejects.toThrow();
      await expect(
        repository.updateGraphLayouts({
          projectId: backend.projectId(),
          layouts: [{ graphId: "graph_absent", layout: LAYOUT }],
        }),
      ).rejects.toThrow();
    });

    it("raises the chart's own absence for a chart write it cannot match", async () => {
      const repository = backend.repository();
      const missing = { projectId: backend.projectId(), chartId: "chart_absent" };

      await expect(
        repository.updateSavedWorkbenchChart({ ...missing, name: "Renamed" }),
      ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
      await expect(repository.deleteSavedWorkbenchChart(missing)).rejects.toMatchObject({
        code: "saved_workbench_chart_not_found",
      });
      await expect(repository.unplaceSavedWorkbenchChart(missing)).rejects.toMatchObject({
        code: "saved_workbench_chart_not_found",
      });
    });
  });

  describe("when dashboards are written", () => {
    it("reads a created dashboard back with its graphs", async () => {
      const repository = backend.repository();
      const created = await dashboard();

      expect(created).toMatchObject({ projectId: backend.projectId(), name: "Reports", order: 0 });
      await expect(
        repository.findDashboard({ projectId: backend.projectId(), dashboardId: created.id }),
      ).resolves.toMatchObject({ id: created.id, graphs: [] });
    });

    it("answers the first and the last by order", async () => {
      const repository = backend.repository();
      const first = await dashboard("First", 0);
      const last = await dashboard("Last", 2);

      await expect(
        repository.findFirstDashboard({ projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: first.id });
      await expect(
        repository.findLastDashboard({ projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: last.id });
    });

    it("narrows a list of ids to the ones the project holds", async () => {
      const repository = backend.repository();
      const held = await dashboard();

      await expect(
        repository.findDashboardIds({
          projectId: backend.projectId(),
          dashboardIds: [held.id, "dash_absent"],
        }),
      ).resolves.toEqual([held.id]);
    });

    it("renames one and renumbers the rest", async () => {
      const repository = backend.repository();
      const first = await dashboard("First", 0);
      const second = await dashboard("Second", 1);

      await expect(
        repository.updateDashboard({
          projectId: backend.projectId(),
          dashboardId: first.id,
          data: { name: "Renamed" },
        }),
      ).resolves.toMatchObject({ id: first.id, name: "Renamed" });

      await repository.updateDashboardOrder({
        projectId: backend.projectId(),
        dashboardIds: [second.id, first.id],
      });

      const listed = await repository.findAllDashboards({
        projectId: backend.projectId(),
        graphKinds: BOTH_KINDS,
      });

      expect(listed.map((row) => row.id)).toEqual([second.id, first.id]);
    });

    it("counts only the chart kinds it was asked to count", async () => {
      const repository = backend.repository();
      const created = await dashboard();
      await graph(created.id);
      const saved = await chart();
      await repository.placeSavedWorkbenchChart({
        projectId: backend.projectId(),
        chartId: saved.id,
        dashboardId: created.id,
        ...LAYOUT,
      });

      const both = await repository.findAllDashboards({
        projectId: backend.projectId(),
        graphKinds: BOTH_KINDS,
      });
      const builderOnly = await repository.findAllDashboards({
        projectId: backend.projectId(),
        graphKinds: ["builder"],
      });

      expect(both[0]?.graphCount).toBe(2);
      expect(builderOnly[0]?.graphCount).toBe(1);
    });

    it("takes its graphs with it when it is deleted", async () => {
      const repository = backend.repository();
      const created = await dashboard();
      const placed = await graph(created.id);

      await expect(
        repository.deleteDashboard({ projectId: backend.projectId(), dashboardId: created.id }),
      ).resolves.toMatchObject({ id: created.id });
      await expect(
        repository.findGraph({ projectId: backend.projectId(), graphId: placed.id }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when builder graphs are written", () => {
    it("reads a created graph back with its payload and layout", async () => {
      const repository = backend.repository();
      const created = await graph(null);

      expect(created).toMatchObject({
        projectId: backend.projectId(),
        name: "Latency",
        graph: { type: "line" },
        filters: {},
        dashboardId: null,
        ...LAYOUT,
      });
      await expect(
        repository.findGraph({ projectId: backend.projectId(), graphId: created.id }),
      ).resolves.toMatchObject({ id: created.id });
    });

    it("orders a dashboard's graphs down the grid", async () => {
      const repository = backend.repository();
      const created = await dashboard();
      const lower = await graph(created.id, "Lower", { ...LAYOUT, gridRow: 3 });
      const upper = await graph(created.id, "Upper", { ...LAYOUT, gridRow: 1 });

      const listed = await repository.findAllGraphs({
        projectId: backend.projectId(),
        dashboardId: created.id,
      });

      expect(listed.map((row) => row.id)).toEqual([upper.id, lower.id]);
      await expect(
        repository.findLastGraphGridRow({
          projectId: backend.projectId(),
          dashboardId: created.id,
        }),
      ).resolves.toBe(3);
    });

    it("edits the fields it was given and leaves the rest alone", async () => {
      const repository = backend.repository();
      const created = await graph(null);

      await expect(
        repository.updateGraph({
          projectId: backend.projectId(),
          graphId: created.id,
          name: "Renamed",
        }),
      ).resolves.toMatchObject({ id: created.id, name: "Renamed", graph: { type: "line" } });
      await expect(
        repository.updateGraph({
          projectId: backend.projectId(),
          graphId: created.id,
          graph: { type: "bar" },
          filters: { status: "error" },
        }),
      ).resolves.toMatchObject({ graph: { type: "bar" }, filters: { status: "error" } });
    });

    it("moves one graph and a whole batch of them", async () => {
      const repository = backend.repository();
      const created = await dashboard();
      const first = await graph(created.id, "First");
      const second = await graph(created.id, "Second", { ...LAYOUT, gridRow: 1 });

      await expect(
        repository.updateGraphLayout({
          projectId: backend.projectId(),
          graphId: first.id,
          layout: { ...LAYOUT, gridRow: 5 },
        }),
      ).resolves.toMatchObject({ gridRow: 5 });

      await repository.updateGraphLayouts({
        projectId: backend.projectId(),
        layouts: [
          { graphId: first.id, layout: { ...LAYOUT, gridRow: 0 } },
          { graphId: second.id, layout: { ...LAYOUT, gridRow: 1, colSpan: 2 } },
        ],
      });

      const listed = await repository.findAllGraphs({
        projectId: backend.projectId(),
        dashboardId: created.id,
      });

      expect(listed.map((row) => ({ id: row.id, gridRow: row.gridRow, colSpan: row.colSpan })))
        .toEqual([
          { id: first.id, gridRow: 0, colSpan: 1 },
          { id: second.id, gridRow: 1, colSpan: 2 },
        ]);
    });

    it("hands back the row it deleted and then answers absence", async () => {
      const repository = backend.repository();
      const created = await graph(null);

      await expect(
        repository.deleteGraph({ projectId: backend.projectId(), graphId: created.id }),
      ).resolves.toMatchObject({ id: created.id });
      await expect(
        repository.findGraph({ projectId: backend.projectId(), graphId: created.id }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when saved workbench charts are written", () => {
    it("reads a created chart back with the definition it was given", async () => {
      const repository = backend.repository();
      const created = await chart();

      expect(created).toMatchObject({
        projectId: backend.projectId(),
        name: "Spend",
        definition: DEFINITION,
        dashboardId: null,
      });
      await expect(
        repository.findSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: created.id,
        }),
      ).resolves.toMatchObject({ id: created.id });
      await expect(
        repository.findAllSavedWorkbenchCharts({ projectId: backend.projectId() }),
      ).resolves.toHaveLength(1);
    });

    it("refuses a second chart carrying an id it already holds", async () => {
      const repository = backend.repository();
      const created = await chart();

      await expect(
        repository.createSavedWorkbenchChart({
          id: created.id,
          projectId: backend.projectId(),
          name: "Other",
          definition: DEFINITION,
        }),
      ).rejects.toMatchObject({ code: "saved_workbench_chart_already_exists" });
    });

    it("edits the name and the definition apart from each other", async () => {
      const repository = backend.repository();
      const created = await chart();
      const rewritten = { ...DEFINITION, sql: "SELECT 2" };

      await expect(
        repository.updateSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: created.id,
          name: "Renamed",
        }),
      ).resolves.toMatchObject({ name: "Renamed", definition: DEFINITION });
      await expect(
        repository.updateSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: created.id,
          definition: rewritten,
        }),
      ).resolves.toMatchObject({ name: "Renamed", definition: rewritten });
    });

    it("places a chart on a dashboard and takes it off again", async () => {
      const repository = backend.repository();
      const created = await dashboard();
      const saved = await chart();

      await expect(
        repository.placeSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: saved.id,
          dashboardId: created.id,
          gridColumn: 1,
          gridRow: 2,
          colSpan: 1,
          rowSpan: 2,
        }),
      ).resolves.toMatchObject({
        dashboardId: created.id,
        gridColumn: 1,
        gridRow: 2,
        colSpan: 1,
        rowSpan: 2,
      });

      await expect(
        repository.unplaceSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: saved.id,
        }),
      ).resolves.toMatchObject({ dashboardId: null, ...LAYOUT });
    });

    it("removes the chart it was asked to remove", async () => {
      const repository = backend.repository();
      const created = await chart();

      await repository.deleteSavedWorkbenchChart({
        projectId: backend.projectId(),
        chartId: created.id,
      });

      await expect(
        repository.findSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: created.id,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the two chart kinds share one table", () => {
    it("never reads a saved chart as a builder graph, or the other way round", async () => {
      const repository = backend.repository();
      const builder = await graph(null);
      const saved = await chart();

      await expect(
        repository.findAllGraphs({ projectId: backend.projectId() }),
      ).resolves.toHaveLength(1);
      await expect(
        repository.findGraph({ projectId: backend.projectId(), graphId: saved.id }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: builder.id,
        }),
      ).resolves.toBeUndefined();
      await expect(
        repository.updateGraph({
          projectId: backend.projectId(),
          graphId: saved.id,
          name: "Renamed",
        }),
      ).rejects.toThrow();
      await expect(
        repository.updateSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: builder.id,
          name: "Renamed",
        }),
      ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
    });
  });

  describe("when another project holds rows of its own", () => {
    it("never reads or edits a dashboard belonging to that project", async () => {
      const repository = backend.repository();
      const foreign = await repository.createDashboard({
        id: id("dash"),
        projectId: backend.otherProjectId(),
        name: "Theirs",
        order: 0,
      });

      await expect(
        repository.findAllDashboards({ projectId: backend.projectId(), graphKinds: BOTH_KINDS }),
      ).resolves.toEqual([]);
      await expect(
        repository.findDashboard({ projectId: backend.projectId(), dashboardId: foreign.id }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findDashboardIds({
          projectId: backend.projectId(),
          dashboardIds: [foreign.id],
        }),
      ).resolves.toEqual([]);
      await expect(
        repository.updateDashboard({
          projectId: backend.projectId(),
          dashboardId: foreign.id,
          data: { name: "Stolen" },
        }),
      ).rejects.toThrow();
      await expect(
        repository.deleteDashboard({ projectId: backend.projectId(), dashboardId: foreign.id }),
      ).rejects.toThrow();
    });

    it("never reads or edits a chart belonging to that project", async () => {
      const repository = backend.repository();
      const foreignGraph = await repository.createGraph({
        id: id("graph"),
        projectId: backend.otherProjectId(),
        name: "Theirs",
        graph: { type: "line" },
        filters: {},
        dashboardId: null,
        layout: LAYOUT,
      });
      const foreignChart = await repository.createSavedWorkbenchChart({
        id: id("chart"),
        projectId: backend.otherProjectId(),
        name: "Theirs",
        definition: DEFINITION,
      });

      await expect(repository.findAllGraphs({ projectId: backend.projectId() })).resolves.toEqual(
        [],
      );
      await expect(
        repository.findGraph({ projectId: backend.projectId(), graphId: foreignGraph.id }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findAllSavedWorkbenchCharts({ projectId: backend.projectId() }),
      ).resolves.toEqual([]);
      await expect(
        repository.findSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: foreignChart.id,
        }),
      ).resolves.toBeUndefined();
      await expect(
        repository.deleteGraph({ projectId: backend.projectId(), graphId: foreignGraph.id }),
      ).rejects.toThrow();
      await expect(
        repository.deleteSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: foreignChart.id,
        }),
      ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
    });
  });
}

describe("given the memory dashboard repository", () => {
  let repository: DashboardRepository;

  beforeEach(() => {
    repository = MemoryDashboardRepository.create();
  });

  contractCases({
    repository: () => repository,
    projectId: () => "project-1",
    otherProjectId: () => "project-2",
  });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres dashboard repository", () => {
  const namespace = `dashboard-contract-${randomUUID()}`;
  let projectId = "";
  let otherProjectId = "";

  const clean = () =>
    cleanupTestRows(database(), [
      ["customGraph", { projectId }],
      ["customGraph", { projectId: otherProjectId }],
      ["dashboard", { projectId }],
      ["dashboard", { projectId: otherProjectId }],
    ]);

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    const team = await database().team.create({
      data: { name: namespace, slug: namespace, organizationId: organization.id },
    });
    const project = (slug: string) =>
      database().project.create({
        data: {
          name: slug,
          slug,
          apiKey: slug,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
        select: { id: true },
      });
    projectId = (await project(`${namespace}-a`)).id;
    otherProjectId = (await project(`${namespace}-b`)).id;
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await cleanupTestRows(database(), [
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["team", { slug: namespace }],
      ["organization", { slug: namespace }],
    ]);
  });

  contractCases({
    repository: () => PrismaDashboardRepository.create({ prisma: database() }),
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
  });
});
