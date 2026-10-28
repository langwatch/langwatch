/**
 * The Dashboards area's boards and each member's stars on them, over the memory repositories
 * the Prisma ones are the twins of. Spec: dashboards-v2.feature.
 */
import { DashboardNotFoundError, MY_DASHBOARD_NAME } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import {
  createDashboardTestAuthz,
  createDashboardTestProjects,
  DASHBOARDS_ROLLED_OUT,
} from "../../app/__tests__/dashboard.fixture.ts";
import { MemoryBoardRepository } from "../../repositories/memory/memory.board.repository.ts";
import { MemoryDashboardWidgetRepository } from "../../repositories/memory/memory.dashboard-widget.repository.ts";
import { MemoryDashboardDatabase } from "../../repositories/memory/memory.dashboard.database.ts";
import { MemoryDashboardRepository } from "../../repositories/memory/memory.dashboard.repository.ts";
import { BoardService } from "../board.service.ts";
import { DashboardAccessService } from "../dashboard-access.service.ts";
import { DashboardStarService } from "../dashboard-star.service.ts";

const PROJECT = "project_1";
const WIDGET = { name: "Usage", code: "export default () => null;", queries: [] };

function serviceWith() {
  const database = MemoryDashboardDatabase.create();
  const boards = MemoryBoardRepository.create({ database });
  const access = DashboardAccessService.create({
    repository: boards,
    projects: createDashboardTestProjects(),
    rollout: DASHBOARDS_ROLLED_OUT,
    authz: createDashboardTestAuthz(),
  });
  return {
    database,
    boards,
    reports: MemoryDashboardRepository.create({ database }),
    widgets: MemoryDashboardWidgetRepository.create({ database }),
    stars: DashboardStarService.create({ repository: boards, access }),
    service: BoardService.create({ repository: boards, access }),
  };
}

const board = (dashboardId: string) => ({ kind: "board" as const, dashboardId });
const template = (templateId: string) => ({ kind: "template" as const, templateId });
const listed = async (stars: DashboardStarService, userId: string) =>
  (await stars.listStarred({ projectId: PROJECT, userId })).map((entry) =>
    entry.kind === "board" ? entry.dashboard.id : `template:${entry.templateId}`,
  );
const codeOf = (call: Promise<unknown>) =>
  call.then(
    () => "<resolved>",
    (error: { code: string }) => error.code,
  );

describe("BoardService", () => {
  describe("given a member creates a board", () => {
    /** @scenario "AC156 No board is pinned unless the member pins it" */
    it("stars it for nobody, the creator included", async () => {
      const { service, stars } = serviceWith();

      const created = await service.createBoard({
        projectId: PROJECT,
        name: "Reports",
        createdById: "member-1",
      });

      expect({
        author: created.createdById,
        starred: await listed(stars, "member-1"),
        listed: (
          await service.findBoards({ projectId: PROJECT, viewer: { userId: "member-1" } })
        ).map(({ isStarred }) => isStarred),
      }).toEqual({ author: "member-1", starred: [], listed: [false] });
    });
  });

  describe("given a member's My dashboard is made", () => {
    const myDashboard = (service: BoardService) =>
      service.createBoard({ projectId: PROJECT, name: MY_DASHBOARD_NAME, createdById: "member-1" });

    /** @scenario "AC160b A member with no My dashboard gets one made, pinned for them" */
    it("stars it for its maker and for nobody else", async () => {
      const { service, stars } = serviceWith();

      const created = await myDashboard(service);

      expect({
        maker: await listed(stars, "member-1"),
        other: await listed(stars, "member-2"),
        listed: (
          await service.findBoards({ projectId: PROJECT, viewer: { userId: "member-1" } })
        ).map(({ isStarred }) => isStarred),
      }).toEqual({ maker: [created.id], other: [], listed: [true] });
    });

    /** @scenario "AC160c A member who unpins My dashboard keeps it unpinned" */
    it("keeps it unstarred once its maker unstars it", async () => {
      const { service, stars } = serviceWith();
      const created = await myDashboard(service);

      await stars.unstar({ projectId: PROJECT, userId: "member-1", star: board(created.id) });
      await service.findBoards({ projectId: PROJECT, viewer: { userId: "member-1" } });

      await expect(listed(stars, "member-1")).resolves.toEqual([]);
    });

    it("stars nobody when the board has no maker", async () => {
      const { service, stars } = serviceWith();

      await service.createBoard({ projectId: PROJECT, name: MY_DASHBOARD_NAME });

      await expect(listed(stars, "member-1")).resolves.toEqual([]);
    });
  });

  describe("given one member's stars", () => {
    /** @scenario "AC157 Stars are per member" */
    it("does not show them to another member", async () => {
      const { service, stars } = serviceWith();
      const created = await service.createBoard({ projectId: PROJECT, name: "Reports" });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(created.id) });

      expect({
        a: await listed(stars, "a"),
        b: await listed(stars, "b"),
        forB: (await service.findBoards({ projectId: PROJECT, viewer: { userId: "b" } })).map(
          ({ isStarred }) => isStarred,
        ),
      }).toEqual({ a: [created.id], b: [], forB: [false] });
    });

    it("appends a star at the end and is idempotent", async () => {
      const { service, stars } = serviceWith();
      const first = await service.createBoard({ projectId: PROJECT, name: "One" });
      const second = await service.createBoard({ projectId: PROJECT, name: "Two" });
      const third = await service.createBoard({ projectId: PROJECT, name: "Three" });

      await stars.star({ projectId: PROJECT, userId: "a", star: board(first.id) });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(third.id) });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(second.id) });
      // Starring twice changes nothing.
      await stars.star({ projectId: PROJECT, userId: "a", star: board(third.id) });

      await expect(listed(stars, "a")).resolves.toEqual([first.id, third.id, second.id]);
    });

    /** @scenario "AC165 A star can point at a From LangWatch board" */
    it("round-trips a template star without checking it against a list", async () => {
      const { stars } = serviceWith();

      await stars.star({ projectId: PROJECT, userId: "a", star: template("llm-costs") });
      await stars.star({ projectId: PROJECT, userId: "a", star: template("llm-costs") });

      await expect(listed(stars, "a")).resolves.toEqual(["template:llm-costs"]);
    });

    /** @scenario "AC165 A star can point at a From LangWatch board" */
    it("lists boards and templates in the order they were starred", async () => {
      const { service, stars } = serviceWith();
      const created = await service.createBoard({ projectId: PROJECT, name: "One" });

      await stars.star({ projectId: PROJECT, userId: "a", star: template("t1") });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(created.id) });

      await expect(listed(stars, "a")).resolves.toEqual(["template:t1", created.id]);
    });

    /** @scenario "AC155 Move up and Move down reorder the member's stars" */
    it("unstars a board or a template and reorders both kinds", async () => {
      const { service, stars } = serviceWith();
      const a = await service.createBoard({ projectId: PROJECT, name: "A" });
      const b = await service.createBoard({ projectId: PROJECT, name: "B" });
      for (const star of [board(a.id), board(b.id), template("t1")]) {
        await stars.star({ projectId: PROJECT, userId: "u", star });
      }

      await stars.unstar({ projectId: PROJECT, userId: "u", star: board(b.id) });
      await expect(listed(stars, "u")).resolves.toEqual([a.id, "template:t1"]);

      await stars.reorderStars({
        projectId: PROJECT,
        userId: "u",
        stars: [template("t1"), board(a.id)],
      });
      await expect(listed(stars, "u")).resolves.toEqual(["template:t1", a.id]);

      await stars.unstar({ projectId: PROJECT, userId: "u", star: template("t1") });
      await expect(listed(stars, "u")).resolves.toEqual([a.id]);
    });

    /** @scenario "AC26 Deleting a board removes it from every member's stars" */
    it("removes the board from every member's stars when it is deleted", async () => {
      const { service, stars } = serviceWith();
      const created = await service.createBoard({ projectId: PROJECT, name: "Shared" });
      await stars.star({ projectId: PROJECT, userId: "a", star: board(created.id) });
      await stars.star({ projectId: PROJECT, userId: "b", star: board(created.id) });

      await service.deleteBoard({ projectId: PROJECT, dashboardId: created.id });

      expect({ a: await listed(stars, "a"), b: await listed(stars, "b") }).toEqual({
        a: [],
        b: [],
      });
    });

    it("refuses a star on a board the project does not have", async () => {
      const { stars } = serviceWith();

      await expect(
        stars.star({ projectId: PROJECT, userId: "a", star: board("missing") }),
      ).rejects.toBeInstanceOf(DashboardNotFoundError);
    });
  });

  describe("given a mixed board, a board copied from Reports with no chart, and a Reports board", () => {
    const viewer = { userId: "member" };

    async function threeBoards() {
      const built = serviceWith();
      const { reports, widgets, stars, boards } = built;
      const mixed = await reports.createDashboard({
        id: "board_mixed",
        projectId: PROJECT,
        name: "Mixed",
        order: 0,
      });
      await reports.createGraph({
        id: "graph_1",
        projectId: PROJECT,
        name: "Latency",
        graph: { graphType: "line" },
        filters: {},
        dashboardId: mixed.id,
        layout: { gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 },
      });
      const copied = await reports.createDashboard({
        id: "board_copied",
        projectId: PROJECT,
        name: "Copied",
        order: 1,
      });
      const legacy = await reports.createDashboard({
        id: "board_reports",
        projectId: PROJECT,
        name: "Reports",
        order: 2,
      });
      // The split copied both into DashboardsV2 under their ids.
      for (const { id, name } of [mixed, copied]) {
        await boards.createBoard({ id, projectId: PROJECT, name });
      }
      await widgets.createWidget({
        id: "widget_1",
        projectId: PROJECT,
        dashboardId: mixed.id,
        input: WIDGET,
      });
      await stars.star({ projectId: PROJECT, userId: viewer.userId, star: board(mixed.id) });
      return { ...built, mixed, copied, legacy };
    }

    const reportsIds = async (reports: MemoryDashboardRepository) =>
      (await reports.findAllDashboards({ projectId: PROJECT, graphKinds: ["builder"] })).map(
        ({ id }) => id,
      );

    /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
    it("deletes the mixed board's Dashboards copy, its widget and stars, and keeps its Reports chart", async () => {
      const { service, reports, widgets, stars, mixed } = await threeBoards();

      await service.deleteBoard({ projectId: PROJECT, dashboardId: mixed.id, viewer });

      expect({
        opened: await codeOf(service.getBoard({ projectId: PROJECT, dashboardId: mixed.id })),
        widgets: await widgets.findAll({ projectId: PROJECT }),
        starred: await listed(stars, viewer.userId),
        reports: (await reportsIds(reports)).includes(mixed.id),
        graph: (await reports.findGraph({ projectId: PROJECT, graphId: "graph_1" }))?.dashboardId,
      }).toEqual({
        opened: "dashboard_not_found",
        widgets: [],
        starred: [],
        reports: true,
        graph: mixed.id,
      });
    });

    /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
    it("deletes the stale Reports copy of a board that holds no Reports chart", async () => {
      const { service, database, copied } = await threeBoards();
      const stored = () => database.dashboards.some((row) => row.id === copied.id);
      const before = stored();

      await service.deleteBoard({ projectId: PROJECT, dashboardId: copied.id, viewer });

      expect({ before, after: stored() }).toEqual({ before: true, after: false });
    });

    /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
    it("answers a delete of a board only Reports holds as not found, and keeps it", async () => {
      const { service, reports, legacy } = await threeBoards();

      expect({
        deleted: await codeOf(
          service.deleteBoard({ projectId: PROJECT, dashboardId: legacy.id, viewer }),
        ),
        reports: (await reportsIds(reports)).includes(legacy.id),
      }).toEqual({ deleted: "dashboard_not_found", reports: true });
    });
  });
});
