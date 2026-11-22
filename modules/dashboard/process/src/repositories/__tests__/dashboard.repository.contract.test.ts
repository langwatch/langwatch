/**
 * @vitest-environment node
 * The Analytics Reports boards, builder graph and saved workbench chart contract, stated once
 * and run against both backends: the memory twin always, and the Postgres one when a test
 * database is named at `LANGWATCH_TEST_DATABASE_URL`.
 * @see specs/dashboard-service.feature
 */
import { randomUUID } from "node:crypto";

import type { SavedWorkbenchChartDefinition } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import {
  databaseUrl,
  id,
  memoryBackend,
  postgresBackend,
  WIDGET_INPUT,
  type DashboardBackend,
} from "./dashboard-repository.fixture.ts";

const LAYOUT = { gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 };
const BOTH_KINDS = ["builder", "workbench_sql"] as const;
const DEFINITION: SavedWorkbenchChartDefinition = {
  version: 1,
  sql: "SELECT 1",
  parameters: {},
};

function contractCases(backend: DashboardBackend): void {
  const dashboard = async (name = "Reports", order = 0) =>
    backend
      .dashboards()
      .createDashboard({ id: id("dash"), projectId: backend.projectId(), name, order });

  const graph = async (dashboardId: string | null, name = "Latency", layout = LAYOUT) =>
    backend.dashboards().createGraph({
      id: id("graph"),
      projectId: backend.projectId(),
      name,
      graph: { type: "line" },
      filters: {},
      dashboardId,
      layout,
    });

  const chart = async (name = "Spend") =>
    backend.dashboards().createSavedWorkbenchChart({
      id: id("chart"),
      projectId: backend.projectId(),
      name,
      definition: DEFINITION,
    });

  describe("when the project holds nothing", () => {
    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("answers every dashboard read with absence rather than a refusal", async () => {
      const repository = backend.dashboards();

      await expect(
        repository.findAllDashboards({ projectId: backend.projectId(), graphKinds: BOTH_KINDS }),
      ).resolves.toEqual([]);
      await expect(
        repository.findDashboard({ projectId: backend.projectId(), dashboardId: "dash_absent" }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findLastDashboard({ projectId: backend.projectId() }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findDashboards({
          projectId: backend.projectId(),
          dashboardIds: ["dash_absent"],
        }),
      ).resolves.toEqual([]);
    });

    it("answers every chart read with absence rather than a refusal", async () => {
      const repository = backend.dashboards();

      await expect(repository.findAllGraphs({ projectId: backend.projectId() })).resolves.toEqual(
        [],
      );
      await expect(
        repository.findGraph({ projectId: backend.projectId(), graphId: "graph_absent" }),
      ).resolves.toBeUndefined();
      await expect(
        repository.findNextFreeGridRow({
          projectId: backend.projectId(),
          dashboardId: "dash_absent",
        }),
      ).resolves.toBe(0);
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
      const repository = backend.dashboards();

      await expect(
        repository.updateDashboard({
          projectId: backend.projectId(),
          dashboardId: "dash_absent",
          data: { name: "Renamed" },
        }),
      ).rejects.toThrow(Error);
      await expect(
        repository.deleteDashboard({
          projectId: backend.projectId(),
          dashboardId: "dash_absent",
        }),
      ).rejects.toThrow(Error);
      await expect(
        repository.updateDashboardOrder({
          projectId: backend.projectId(),
          dashboardIds: ["dash_absent"],
        }),
      ).rejects.toThrow(Error);
    });

    it("refuses a graph write that names a row it does not hold", async () => {
      const repository = backend.dashboards();

      await expect(
        repository.updateGraph({
          projectId: backend.projectId(),
          graphId: "graph_absent",
          name: "Renamed",
        }),
      ).rejects.toThrow(Error);
      await expect(
        repository.deleteGraph({ projectId: backend.projectId(), graphId: "graph_absent" }),
      ).rejects.toThrow(Error);
      await expect(
        repository.updateGraphLayout({
          projectId: backend.projectId(),
          graphId: "graph_absent",
          layout: LAYOUT,
        }),
      ).rejects.toThrow(Error);
      await expect(
        repository.updateGraphLayouts({
          projectId: backend.projectId(),
          layouts: [{ graphId: "graph_absent", layout: LAYOUT }],
        }),
      ).rejects.toThrow(Error);
    });

    it("raises the chart's own absence for a chart write it cannot match", async () => {
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
      const created = await dashboard();

      expect(created).toMatchObject({ projectId: backend.projectId(), name: "Reports", order: 0 });
      await expect(
        repository.findDashboard({ projectId: backend.projectId(), dashboardId: created.id }),
      ).resolves.toMatchObject({ id: created.id, graphs: [] });
    });

    it("answers the last by order", async () => {
      const repository = backend.dashboards();
      await dashboard("First", 0);
      const last = await dashboard("Last", 2);

      await expect(
        repository.findLastDashboard({ projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: last.id });
    });

    it("narrows a list of ids to the rows the project holds", async () => {
      const repository = backend.dashboards();
      const held = await dashboard();

      const found = await repository.findDashboards({
        projectId: backend.projectId(),
        dashboardIds: [held.id, "dash_absent"],
      });

      expect(found.map((row) => row.id)).toEqual([held.id]);
    });

    it("renames one and renumbers the rest", async () => {
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
      const created = await dashboard();
      const lower = await graph(created.id, "Lower", { ...LAYOUT, gridRow: 3 });
      const upper = await graph(created.id, "Upper", { ...LAYOUT, gridRow: 1 });

      const listed = await repository.findAllGraphs({
        projectId: backend.projectId(),
        dashboardId: created.id,
      });

      expect(listed.map((row) => row.id)).toEqual([upper.id, lower.id]);
      await expect(
        repository.findNextFreeGridRow({
          projectId: backend.projectId(),
          dashboardId: created.id,
        }),
      ).resolves.toBe(3 + LAYOUT.rowSpan);
    });

    it("edits the fields it was given and leaves the rest alone", async () => {
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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

      expect(
        listed.map((row) => ({ id: row.id, gridRow: row.gridRow, colSpan: row.colSpan })),
      ).toEqual([
        { id: first.id, gridRow: 0, colSpan: 1 },
        { id: second.id, gridRow: 1, colSpan: 2 },
      ]);
    });

    it("hands back the row it deleted and then answers absence", async () => {
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      const repository = backend.dashboards();
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
      ).rejects.toThrow(Error);
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
      const repository = backend.dashboards();
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
        repository.findDashboards({
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
      ).rejects.toThrow(Error);
      await expect(
        repository.deleteDashboard({ projectId: backend.projectId(), dashboardId: foreign.id }),
      ).rejects.toThrow(Error);
    });

    it("never reads or edits a chart belonging to that project", async () => {
      const repository = backend.dashboards();
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
      ).rejects.toThrow(Error);
      await expect(
        repository.deleteSavedWorkbenchChart({
          projectId: backend.projectId(),
          chartId: foreignChart.id,
        }),
      ).rejects.toMatchObject({ code: "saved_workbench_chart_not_found" });
    });
  });

  describe("when the Dashboards area holds a copy of a board", () => {
    const projectId = () => backend.projectId();
    /** A Reports board copied into DashboardsV2 under its id, with a stale srcdoc row on it. */
    const copied = async (name: string) => {
      const board = await dashboard(name);
      await backend.boards().createBoard({ id: board.id, projectId: projectId(), name });
      await backend.seedStaleCopy({
        id: id("widget"),
        projectId: projectId(),
        dashboardId: board.id,
      });
      return board;
    };

    /** @scenario "AC199 Split: Dashboards and Analytics Reports each list and open only their own boards" */
    it("leaves out of every read a board only Dashboards holds, and keeps a mixed one", async () => {
      const repository = backend.dashboards();
      const reports = await dashboard("Reports only", 0);
      await graph(reports.id);
      const moved = await copied("Widgets only");
      const mixed = await copied("Mixed");
      const saved = await chart();
      await repository.placeSavedWorkbenchChart({
        projectId: projectId(),
        chartId: saved.id,
        dashboardId: mixed.id,
        ...LAYOUT,
      });
      const all = [reports.id, moved.id, mixed.id];

      const listed = await repository.findAllDashboards({
        projectId: projectId(),
        graphKinds: BOTH_KINDS,
      });

      expect({
        listed: listed.map((row) => [row.id, row.graphCount]),
        among: (await repository.findDashboards({ projectId: projectId(), dashboardIds: all }))
          .map((row) => row.id)
          .toSorted(),
        opened: await repository.findDashboard({ projectId: projectId(), dashboardId: moved.id }),
        mixed: (await repository.findDashboard({ projectId: projectId(), dashboardId: mixed.id }))
          ?.id,
        dashboardsOnly: await repository.findDashboardsOnlyIds({
          projectId: projectId(),
          dashboardIds: all,
        }),
      }).toEqual({
        // Same order, so by name.
        listed: [
          [mixed.id, 1],
          [reports.id, 1],
        ],
        among: [reports.id, mixed.id].toSorted(),
        opened: undefined,
        mixed: mixed.id,
        dashboardsOnly: [moved.id],
      });
    });

    /** @scenario "AC199m Split: Analytics Reports keeps another member's Only me board hidden" */
    it("leaves another member's Only me board and its charts out of every read", async () => {
      const repository = backend.dashboards();
      const mixed = await copied("Mixed");
      const placed = await graph(mixed.id);
      const loose = await graph(null, "Loose");
      const saved = await chart();
      await repository.placeSavedWorkbenchChart({
        projectId: projectId(),
        chartId: saved.id,
        dashboardId: mixed.id,
        ...LAYOUT,
      });
      await backend.seedOnlyMeReportsBoard({ dashboardId: mixed.id, createdById: "author" });
      const readBy = async (viewer?: { userId: string }) => {
        const reach = { projectId: projectId(), viewer };
        return {
          listed: (await repository.findAllDashboards({ ...reach, graphKinds: BOTH_KINDS })).map(
            (row) => row.id,
          ),
          among: (await repository.findDashboards({ ...reach, dashboardIds: [mixed.id] })).map(
            (row) => row.id,
          ),
          opened: (await repository.findDashboard({ ...reach, dashboardId: mixed.id }))?.id,
          graphs: (await repository.findAllGraphs(reach)).map((row) => row.id).toSorted(),
          graph: (await repository.findGraph({ ...reach, graphId: placed.id }))?.id,
          charts: (await repository.findAllSavedWorkbenchCharts(reach)).map((row) => row.id),
          chart: (await repository.findSavedWorkbenchChart({ ...reach, chartId: saved.id }))?.id,
        };
      };
      const hidden = {
        listed: [],
        among: [],
        opened: undefined,
        graphs: [loose.id],
        graph: undefined,
        charts: [],
        chart: undefined,
      };

      expect({
        author: await readBy({ userId: "author" }),
        member: await readBy({ userId: "member" }),
        credential: await readBy(),
      }).toEqual({
        author: {
          listed: [mixed.id],
          among: [mixed.id],
          opened: mixed.id,
          graphs: [placed.id, loose.id].toSorted(),
          graph: placed.id,
          charts: [saved.id],
          chart: saved.id,
        },
        member: hidden,
        credential: hidden,
      });
    });

    it("never counts a stale srcdoc copy as a card on the grid or in the usage count", async () => {
      const repository = backend.dashboards();
      const board = await dashboard();
      await graph(board.id, "Latency", { ...LAYOUT, gridRow: 1 });
      await backend.seedStaleCopy({
        id: id("widget"),
        projectId: projectId(),
        dashboardId: board.id,
        rowSpan: 5,
      });
      await backend
        .widgets()
        .createWidget({ id: id("widget"), projectId: projectId(), input: WIDGET_INPUT });

      expect({
        nextRow: await repository.findNextFreeGridRow({
          projectId: projectId(),
          dashboardId: board.id,
        }),
        usage: await repository.countUsage({ projectIds: [projectId()] }),
      }).toEqual({ nextRow: 2, usage: { builderCharts: 1, charts: 2 } });
    });

    /** @scenario "AC199d Split: a Reports delete leaves the Dashboards area unchanged" */
    it("deletes a Reports board and its charts, and leaves every Dashboards row", async () => {
      const repository = backend.dashboards();
      const boards = backend.boards();
      const reports = await dashboard("Reports only", 0);
      const mixed = await dashboard("Mixed", 1);
      await boards.createBoard({ id: mixed.id, projectId: projectId(), name: "Mixed" });
      await graph(reports.id);
      await graph(mixed.id);
      const widget = await backend.widgets().createWidget({
        id: id("widget"),
        projectId: projectId(),
        dashboardId: mixed.id,
        input: WIDGET_INPUT,
      });
      await boards.addStar({
        projectId: projectId(),
        userId: "u",
        star: { kind: "board", dashboardId: mixed.id },
      });
      const dashboardsArea = async () => ({
        boards: (await boards.findBoards({ projectId: projectId() })).map((row) => row.id),
        widgets: (await backend.widgets().findAll({ projectId: projectId() })).map((row) => [
          row.id,
          row.dashboardId,
        ]),
        stars: await boards.findStarredDashboardIds({ projectId: projectId(), userId: "u" }),
      });
      const before = await dashboardsArea();

      for (const dashboardId of [reports.id, mixed.id]) {
        await repository.deleteDashboard({ projectId: projectId(), dashboardId });
      }

      expect({
        after: await dashboardsArea(),
        reports: await repository.findAllDashboards({
          projectId: projectId(),
          graphKinds: BOTH_KINDS,
        }),
        graphs: await repository.findAllGraphs({ projectId: projectId() }),
      }).toEqual({ after: before, reports: [], graphs: [] });
      expect(before).toEqual({
        boards: [mixed.id],
        widgets: [[widget.id, mixed.id]],
        stars: [mixed.id],
      });
    });
  });
}

describe("given the memory Reports repository", () => {
  contractCases(memoryBackend());
});

describe.skipIf(!databaseUrl)("given the Postgres Reports repository", () => {
  contractCases(postgresBackend(`dashboard-contract-${randomUUID()}`));
});
