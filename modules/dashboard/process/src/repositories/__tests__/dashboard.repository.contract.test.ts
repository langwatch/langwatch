import { randomUUID } from "node:crypto";

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
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { DashboardRepository } from "../dashboard.repository.ts";
import { MemoryDashboardRepository } from "../memory/memory.dashboard.repository.ts";
import { PrismaDashboardRepository } from "../prisma/prisma.dashboard.repository.ts";

/** One backend under test, plus the two projects the isolation cases read. */
type Backend = Readonly<{
  repository: () => DashboardRepository;
  projectId: () => string;
  otherProjectId: () => string;
  /** The organization both projects sit in. */
  organizationId: () => string;
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
    backend
      .repository()
      .createDashboard({ id: id("dash"), projectId: backend.projectId(), name, order });

  const graph = async (dashboardId: string | null, name = "Latency", layout = LAYOUT) =>
    backend.repository().createGraph({
      id: id("graph"),
      projectId: backend.projectId(),
      name,
      graph: { type: "line" },
      filters: {},
      dashboardId,
      layout,
    });

  const chart = async (name = "Spend") =>
    backend.repository().createSavedWorkbenchChart({
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
      const repository = backend.repository();

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
      const repository = backend.repository();

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
      const repository = backend.repository();

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

    it("answers the last by order", async () => {
      const repository = backend.repository();
      await dashboard("First", 0);
      const last = await dashboard("Last", 2);

      await expect(
        repository.findLastDashboard({ projectId: backend.projectId() }),
      ).resolves.toMatchObject({ id: last.id });
    });

    it("narrows a list of ids to the rows the project holds", async () => {
      const repository = backend.repository();
      const held = await dashboard();

      const found = await repository.findDashboards({
        projectId: backend.projectId(),
        dashboardIds: [held.id, "dash_absent"],
      });

      expect(found.map((row) => row.id)).toEqual([held.id]);
    });

    /** @scenario "AC170 Scope: a new board starts at Project and My dashboard at Only me" */
    it("stores a new board at the scope Project unless one is named", async () => {
      const repository = backend.repository();
      const plain = await dashboard("Plain", 0);
      const mine = await repository.createDashboard({
        id: id("dash"),
        projectId: backend.projectId(),
        name: "Mine",
        order: 1,
        createdById: "u",
        scope: "PRIVATE",
      });

      expect(plain).toMatchObject({ scope: "PROJECT", organizationId: null });
      expect(mine).toMatchObject({ scope: "PRIVATE", createdById: "u" });
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

  describe("when another project of the organization shares a board", () => {
    const here = () => ({
      projectId: backend.projectId(),
      organizationId: backend.organizationId(),
    });
    const shared = async (name = "Shared") => {
      const repository = backend.repository();
      const board = await repository.createDashboard({
        id: id("dash"),
        projectId: backend.otherProjectId(),
        name,
        order: 0,
        createdById: "author",
      });
      return repository.updateDashboard({
        projectId: backend.otherProjectId(),
        dashboardId: board.id,
        data: { scope: "ORGANIZATION", organizationId: backend.organizationId() },
      });
    };

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("lists it after the project's own boards, with the cards its owner stored", async () => {
      const repository = backend.repository();
      const own = await dashboard("Own", 0);
      const board = await shared();
      await repository.createGraph({
        id: id("graph"),
        projectId: backend.otherProjectId(),
        name: "Latency",
        graph: { type: "line" },
        filters: {},
        dashboardId: board.id,
        layout: LAYOUT,
      });

      const listed = await repository.findAllDashboards({ ...here(), graphKinds: BOTH_KINDS });

      expect(listed.map((row) => [row.id, row.graphCount])).toEqual([
        [own.id, 0],
        [board.id, 1],
      ]);
      expect(listed[1]).toMatchObject({
        scope: "ORGANIZATION",
        projectId: backend.otherProjectId(),
      });
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("opens it by id with its graphs, and finds it among ids", async () => {
      const repository = backend.repository();
      const board = await shared();

      await expect(
        repository.findDashboard({ ...here(), dashboardId: board.id }),
      ).resolves.toMatchObject({ id: board.id, graphs: [] });
      const found = await repository.findDashboards({ ...here(), dashboardIds: [board.id] });
      expect(found.map((row) => row.id)).toEqual([board.id]);
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("reaches nothing without the organization, or from another organization", async () => {
      const repository = backend.repository();
      const board = await shared();
      const elsewhere = { projectId: backend.projectId(), organizationId: "org_elsewhere" };

      for (const reach of [{ projectId: backend.projectId() }, elsewhere]) {
        await expect(
          repository.findAllDashboards({ ...reach, graphKinds: BOTH_KINDS }),
        ).resolves.toEqual([]);
        await expect(
          repository.findDashboard({ ...reach, dashboardId: board.id }),
        ).resolves.toBeUndefined();
      }
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("never reaches a board of another project that is not set to Organization", async () => {
      const repository = backend.repository();
      const board = await shared();
      await repository.updateDashboard({
        projectId: backend.otherProjectId(),
        dashboardId: board.id,
        data: { scope: "PROJECT" },
      });

      await expect(
        repository.findAllDashboards({ ...here(), graphKinds: BOTH_KINDS }),
      ).resolves.toEqual([]);
      await expect(
        repository.findDashboards({ ...here(), dashboardIds: [board.id] }),
      ).resolves.toEqual([]);
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("refuses a write that names it from the project that does not own it", async () => {
      const repository = backend.repository();
      const board = await shared();

      await expect(
        repository.updateDashboard({
          projectId: backend.projectId(),
          dashboardId: board.id,
          data: { name: "Stolen" },
        }),
      ).rejects.toThrow(Error);
      await expect(
        repository.deleteDashboard({ projectId: backend.projectId(), dashboardId: board.id }),
      ).rejects.toThrow(Error);
    });

    /** @scenario "AC176 Scope: a narrower scope keeps other members' stars" */
    it("keeps one star under the owning project, listed in each project that shares it", async () => {
      const repository = backend.repository();
      const own = await dashboard("Own", 0);
      const board = await shared();
      const owner = backend.otherProjectId();
      await repository.addStar({
        projectId: backend.projectId(),
        userId: "u",
        star: { kind: "board", dashboardId: own.id },
      });
      await repository.addStar({
        projectId: owner,
        userId: "u",
        star: { kind: "board", dashboardId: board.id },
        listedInProjectId: backend.projectId(),
      });

      const listed = await repository.findStarred({
        projectId: backend.projectId(),
        userId: "u",
        sharedProjectIds: [owner],
      });

      expect(listed.map((row) => (row.kind === "board" ? row.dashboard.id : row.kind))).toEqual([
        own.id,
        board.id,
      ]);
      await expect(
        repository.findStarredDashboardIds({ projectId: owner, userId: "u" }),
      ).resolves.toEqual([board.id]);
      await expect(
        repository.findStarred({ projectId: backend.projectId(), userId: "u" }),
      ).resolves.toHaveLength(1);
    });

    /** @scenario "AC176 Scope: a narrower scope keeps other members' stars" */
    it("reorders a shared board's star with the project's own", async () => {
      const repository = backend.repository();
      const own = await dashboard("Own", 0);
      const board = await shared();
      const owner = backend.otherProjectId();
      const stars = [own, board].map((row) => ({ kind: "board" as const, dashboardId: row.id }));
      await repository.addStar({ projectId: backend.projectId(), userId: "u", star: stars[0]! });
      await repository.addStar({
        projectId: owner,
        userId: "u",
        star: stars[1]!,
        listedInProjectId: backend.projectId(),
      });

      await repository.reorderStars({
        projectId: backend.projectId(),
        userId: "u",
        sharedProjectIds: [owner],
        stars: stars.toReversed(),
      });

      await expect(
        repository.findStarredDashboardIds({
          projectId: backend.projectId(),
          userId: "u",
          sharedProjectIds: [owner],
        }),
      ).resolves.toEqual([board.id, own.id]);
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("counts the members other than one who starred a board", async () => {
      const repository = backend.repository();
      const board = await dashboard();
      const star = { kind: "board" as const, dashboardId: board.id };
      for (const userId of ["author", "v", "w"]) {
        await repository.addStar({ projectId: backend.projectId(), userId, star });
      }

      await expect(
        repository.countOtherStars({
          projectId: backend.projectId(),
          dashboardId: board.id,
          userId: "author",
        }),
      ).resolves.toBe(2);
    });
  });

  describe("when a member stars dashboards", () => {
    const starred = (userId: string) =>
      backend
        .repository()
        .findStarred({ projectId: backend.projectId(), userId })
        .then((rows) =>
          rows.map((row) =>
            row.kind === "board" ? row.dashboard.id : `template:${row.templateId}`,
          ),
        );
    const star = (userId: string, dashboardId: string) =>
      backend
        .repository()
        .addStar({ projectId: backend.projectId(), userId, star: { kind: "board", dashboardId } });
    const starTemplate = (userId: string, templateId: string) =>
      backend.repository().addStar({
        projectId: backend.projectId(),
        userId,
        star: { kind: "template", templateId },
      });

    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("appends each star after the last and ignores a repeat", async () => {
      const [a, b, c] = [await dashboard("A", 0), await dashboard("B", 1), await dashboard("C", 2)];

      await star("u", c.id);
      await star("u", a.id);
      await star("u", c.id);
      await star("u", b.id);

      await expect(starred("u")).resolves.toEqual([c.id, a.id, b.id]);
    });

    it("keeps one member's stars apart from another's", async () => {
      const a = await dashboard();

      await star("u", a.id);

      await expect(starred("u")).resolves.toEqual([a.id]);
      await expect(starred("v")).resolves.toEqual([]);
    });

    it("answers the starred ids of the member in this project only", async () => {
      const repository = backend.repository();
      const a = await dashboard("A", 0);
      await dashboard("B", 1);
      await star("u", a.id);

      await expect(
        repository.findStarredDashboardIds({ projectId: backend.projectId(), userId: "u" }),
      ).resolves.toEqual([a.id]);
      await expect(
        repository.findStarredDashboardIds({ projectId: backend.otherProjectId(), userId: "u" }),
      ).resolves.toEqual([]);
    });

    it("removes a star and leaves the others in order", async () => {
      const [a, b, c] = [await dashboard("A", 0), await dashboard("B", 1), await dashboard("C", 2)];
      await star("u", a.id);
      await star("u", b.id);
      await star("u", c.id);

      await backend.repository().removeStar({
        projectId: backend.projectId(),
        userId: "u",
        star: { kind: "board", dashboardId: b.id },
      });

      await expect(starred("u")).resolves.toEqual([a.id, c.id]);
    });

    it("rewrites the order of the starred boards from the ids given", async () => {
      const [a, b, c] = [await dashboard("A", 0), await dashboard("B", 1), await dashboard("C", 2)];
      await star("u", a.id);
      await star("u", b.id);
      await star("u", c.id);

      await backend.repository().reorderStars({
        projectId: backend.projectId(),
        userId: "u",
        stars: [c.id, a.id, b.id].map((dashboardId) => ({ kind: "board" as const, dashboardId })),
      });

      await expect(starred("u")).resolves.toEqual([c.id, a.id, b.id]);
    });

    it("removes the board from every member's stars when it is deleted", async () => {
      const a = await dashboard();
      await star("u", a.id);
      await star("v", a.id);

      await backend
        .repository()
        .deleteDashboard({ projectId: backend.projectId(), dashboardId: a.id });

      await expect(starred("u")).resolves.toEqual([]);
      await expect(starred("v")).resolves.toEqual([]);
    });

    it("keeps a template star beside a board star, in the order starred", async () => {
      const a = await dashboard();

      await starTemplate("u", "llm-costs");
      await star("u", a.id);
      await starTemplate("u", "llm-costs");

      await expect(starred("u")).resolves.toEqual(["template:llm-costs", a.id]);
    });

    it("reorders template and board stars together", async () => {
      const [a, b] = [await dashboard("A", 0), await dashboard("B", 1)];
      await star("u", a.id);
      await starTemplate("u", "t1");
      await star("u", b.id);

      await backend.repository().reorderStars({
        projectId: backend.projectId(),
        userId: "u",
        stars: [
          { kind: "board", dashboardId: b.id },
          { kind: "template", templateId: "t1" },
          { kind: "board", dashboardId: a.id },
        ],
      });

      await expect(starred("u")).resolves.toEqual([b.id, "template:t1", a.id]);
    });

    it("removes a template star and leaves the board star", async () => {
      const a = await dashboard();
      await star("u", a.id);
      await starTemplate("u", "t1");

      await backend.repository().removeStar({
        projectId: backend.projectId(),
        userId: "u",
        star: { kind: "template", templateId: "t1" },
      });

      await expect(starred("u")).resolves.toEqual([a.id]);
    });

    it("keeps template stars apart per member and out of the starred board ids", async () => {
      const a = await dashboard();
      await star("u", a.id);
      await starTemplate("u", "t1");

      await expect(starred("v")).resolves.toEqual([]);
      await expect(
        backend
          .repository()
          .findStarredDashboardIds({ projectId: backend.projectId(), userId: "u" }),
      ).resolves.toEqual([a.id]);
    });

    it("leaves template stars alone when a board is deleted", async () => {
      const a = await dashboard();
      await star("u", a.id);
      await starTemplate("u", "t1");

      await backend
        .repository()
        .deleteDashboard({ projectId: backend.projectId(), dashboardId: a.id });

      await expect(starred("u")).resolves.toEqual(["template:t1"]);
    });
  });

  describe("when favourites are written", () => {
    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("appends stars in order and is idempotent", async () => {
      const repository = backend.repository();
      const one = await dashboard("One", 0);
      const two = await dashboard("Two", 1);
      const star = (dashboardId: string) =>
        repository.addStar({
          projectId: backend.projectId(),
          userId: "u",
          star: { kind: "board", dashboardId },
        });

      await star(two.id);
      await star(one.id);
      await star(two.id);

      await expect(
        repository.findStarredDashboardIds({ projectId: backend.projectId(), userId: "u" }),
      ).resolves.toEqual([two.id, one.id]);
      const listed = await repository.findStarred({
        projectId: backend.projectId(),
        userId: "u",
      });
      expect(listed.map((row) => (row.kind === "board" ? row.dashboard.id : null))).toEqual([
        two.id,
        one.id,
      ]);
    });

    it("unstars and reorders a member's stars without touching another member's", async () => {
      const repository = backend.repository();
      const a = await dashboard("A", 0);
      const b = await dashboard("B", 1);
      const c = await dashboard("C", 2);
      const projectId = backend.projectId();
      for (const dashboardId of [a.id, b.id, c.id]) {
        await repository.addStar({ projectId, userId: "u", star: { kind: "board", dashboardId } });
      }
      await repository.addStar({
        projectId,
        userId: "other",
        star: { kind: "board", dashboardId: a.id },
      });

      await repository.removeStar({
        projectId,
        userId: "u",
        star: { kind: "board", dashboardId: b.id },
      });
      await repository.reorderStars({
        projectId,
        userId: "u",
        stars: [c.id, a.id].map((dashboardId) => ({ kind: "board" as const, dashboardId })),
      });

      await expect(repository.findStarredDashboardIds({ projectId, userId: "u" })).resolves.toEqual(
        [c.id, a.id],
      );
      await expect(
        repository.findStarredDashboardIds({ projectId, userId: "other" }),
      ).resolves.toEqual([a.id]);
    });

    it("drops a board from every member's stars when it is deleted", async () => {
      const repository = backend.repository();
      const board = await dashboard();
      const projectId = backend.projectId();
      const star = { kind: "board" as const, dashboardId: board.id };
      await repository.addStar({ projectId, userId: "u", star });
      await repository.addStar({ projectId, userId: "other", star });

      await repository.deleteDashboard({ projectId, dashboardId: board.id });

      await expect(repository.findStarredDashboardIds({ projectId, userId: "u" })).resolves.toEqual(
        [],
      );
      await expect(
        repository.findStarredDashboardIds({ projectId, userId: "other" }),
      ).resolves.toEqual([]);
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
        repository.findNextFreeGridRow({
          projectId: backend.projectId(),
          dashboardId: created.id,
        }),
      ).resolves.toBe(3 + LAYOUT.rowSpan);
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

      expect(
        listed.map((row) => ({ id: row.id, gridRow: row.gridRow, colSpan: row.colSpan })),
      ).toEqual([
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
      ).rejects.toThrow(Error);
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
    organizationId: () => "organization-1",
  });
});

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("dashboard-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres dashboard repository", () => {
  const namespace = `dashboard-contract-${randomUUID()}`;
  let projectId = "";
  let otherProjectId = "";
  let organizationId = "";

  const clean = () =>
    cleanupTestRows(database(), [
      ["dashboardFavourite", { projectId }],
      ["dashboardFavourite", { projectId: otherProjectId }],
      ["customGraph", { projectId }],
      ["customGraph", { projectId: otherProjectId }],
      ["dashboard", { projectId }],
      ["dashboard", { projectId: otherProjectId }],
    ]);

  beforeAll(async () => {
    const organization = await database().organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
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
    organizationId: () => organizationId,
  });
});
import { createLogger } from "@langwatch/observability";
