/**
 * @vitest-environment node
 * Dashboards boards, stars and widget deletes on memory and Postgres; no delete reaches Reports.
 * @see specs/dashboards-v2.feature
 */
import { randomUUID } from "node:crypto";

import { DashboardNotFoundError, type DashboardStar } from "@langwatch/dashboard-contract";
import { describe, expect, it } from "vitest";

import type { BoardReach } from "../board.repository.ts";
import {
  database,
  databaseUrl,
  id,
  memoryBackend,
  postgresBackend,
  WIDGET_INPUT,
  type DashboardBackend,
} from "./dashboard-repository.fixture.ts";

const LAYOUT = { gridColumn: 0, gridRow: 0, colSpan: 1, rowSpan: 1 };

const boardStar = (dashboardId: string): DashboardStar => ({ kind: "board", dashboardId });

function contractCases(backend: DashboardBackend): void {
  const board = async (name = "Board", projectId = backend.projectId()) =>
    backend.boards().createBoard({ id: id("dash"), projectId, name, createdById: "author" });

  const widget = (dashboardId?: string) =>
    backend.widgets().createWidget({
      id: id("widget"),
      projectId: backend.projectId(),
      ...(dashboardId === undefined ? {} : { dashboardId }),
      input: WIDGET_INPUT,
    });

  describe("when the project holds nothing", () => {
    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("answers every read with absence and refuses every write", async () => {
      const boards = backend.boards();
      const absent = { projectId: backend.projectId(), dashboardId: "dash_absent" };

      await expect(boards.findBoards({ projectId: backend.projectId() })).resolves.toEqual([]);
      await expect(
        boards.findBoardsByIds({ projectId: backend.projectId(), dashboardIds: ["dash_absent"] }),
      ).resolves.toEqual([]);
      await expect(boards.updateBoard({ ...absent, data: { name: "Renamed" } })).rejects.toThrow(
        Error,
      );
      await expect(boards.deleteBoard(absent)).rejects.toThrow(DashboardNotFoundError);
    });
  });

  describe("when a widget is placed on a board the project does not own", () => {
    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("refuses it as a missing board", async () => {
      const foreign = await board("Theirs", backend.otherProjectId());

      await expect(widget("dash_absent")).rejects.toThrow(DashboardNotFoundError);
      await expect(widget(foreign.id)).rejects.toThrow(DashboardNotFoundError);
    });
  });

  describe("when boards are written", () => {
    /** @scenario "AC170 Scope: a new board starts at Project and My dashboard at Only me" */
    it("stores a new board at the scope Project unless one is named", async () => {
      const boards = backend.boards();
      const plain = await boards.createBoard({
        id: id("dash"),
        projectId: backend.projectId(),
        name: "Plain",
      });
      const mine = await boards.createBoard({
        id: id("dash"),
        projectId: backend.projectId(),
        name: "Mine",
        createdById: "u",
        scope: "PRIVATE",
      });

      expect(plain).toMatchObject({
        scope: "PROJECT",
        organizationId: null,
        createdById: null,
        description: null,
        order: 0,
      });
      expect(mine).toMatchObject({ scope: "PRIVATE", createdById: "u" });
    });

    it("edits the fields it was given and reads the board back by id", async () => {
      const boards = backend.boards();
      const created = await board("First");

      await expect(
        boards.updateBoard({
          projectId: backend.projectId(),
          dashboardId: created.id,
          data: { name: "Renamed", description: "Spend by model" },
        }),
      ).resolves.toMatchObject({ id: created.id, name: "Renamed", description: "Spend by model" });
      await expect(
        boards.findBoardsByIds({
          projectId: backend.projectId(),
          dashboardIds: [created.id, "dash_absent"],
        }),
      ).resolves.toMatchObject([{ id: created.id, name: "Renamed" }]);
    });

    it("counts the widgets placed on each board, and no unplaced one", async () => {
      const [withWidgets, empty] = [await board("Widgets"), await board("Empty")];
      await widget(withWidgets.id);
      await widget(withWidgets.id);
      await widget();

      const listed = await backend.boards().findBoards({ projectId: backend.projectId() });

      expect(new Map(listed.map((row) => [row.id, row.graphCount]))).toEqual(
        new Map([
          [withWidgets.id, 2],
          [empty.id, 0],
        ]),
      );
    });
  });

  describe("when another project of the organization shares a board", () => {
    let archived = false;
    const reach = (): BoardReach => ({
      projectId: backend.projectId(),
      organization: {
        organizationId: backend.organizationId(),
        liveProjectIds: archived
          ? [backend.projectId()]
          : [backend.projectId(), backend.otherProjectId()],
      },
    });
    const shared = async (name = "Shared") => {
      archived = false;
      const created = await board(name, backend.otherProjectId());
      return backend.boards().updateBoard({
        projectId: backend.otherProjectId(),
        dashboardId: created.id,
        data: { scope: "ORGANIZATION", organizationId: backend.organizationId() },
      });
    };

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("lists it after the project's own boards, with the widgets its owner stored", async () => {
      const own = await board("Own");
      const sharedBoard = await shared();
      await backend.widgets().createWidget({
        id: id("widget"),
        projectId: backend.otherProjectId(),
        dashboardId: sharedBoard.id,
        input: WIDGET_INPUT,
      });

      const listed = await backend.boards().findBoards(reach());

      expect(listed.map((row) => [row.id, row.graphCount])).toEqual([
        [own.id, 0],
        [sharedBoard.id, 1],
      ]);
      expect(listed[1]).toMatchObject({
        scope: "ORGANIZATION",
        projectId: backend.otherProjectId(),
      });
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("finds it among ids, and nothing without the organization or from another", async () => {
      const boards = backend.boards();
      const sharedBoard = await shared();
      const elsewhere: BoardReach = {
        projectId: backend.projectId(),
        organization: {
          organizationId: "org_elsewhere",
          liveProjectIds: [backend.projectId(), backend.otherProjectId()],
        },
      };

      const found = await boards.findBoardsByIds({ ...reach(), dashboardIds: [sharedBoard.id] });

      expect(found.map((row) => row.id)).toEqual([sharedBoard.id]);
      for (const other of [{ projectId: backend.projectId() }, elsewhere]) {
        await expect(boards.findBoards(other)).resolves.toEqual([]);
        await expect(
          boards.findBoardsByIds({ ...other, dashboardIds: [sharedBoard.id] }),
        ).resolves.toEqual([]);
      }
    });

    /** @scenario "AC172 Scope: an Organization board is listed in every project of its organization" */
    it("never reaches a board of another project that is not set to Organization", async () => {
      const boards = backend.boards();
      const sharedBoard = await shared();
      await boards.updateBoard({
        projectId: backend.otherProjectId(),
        dashboardId: sharedBoard.id,
        data: { scope: "PROJECT" },
      });

      await expect(boards.findBoards(reach())).resolves.toEqual([]);
      await expect(
        boards.findBoardsByIds({ ...reach(), dashboardIds: [sharedBoard.id] }),
      ).resolves.toEqual([]);
    });

    /** @scenario "AC188 Scope: an Organization board of an archived project is listed nowhere" */
    it("stops reaching it by list and among ids once its project is not among the live ones", async () => {
      const boards = backend.boards();
      const own = await board("Own");
      const sharedBoard = await shared();
      archived = true;

      expect({
        listed: (await boards.findBoards(reach())).map((row) => row.id),
        among: await boards.findBoardsByIds({ ...reach(), dashboardIds: [sharedBoard.id] }),
      }).toEqual({ listed: [own.id], among: [] });
    });

    /** @scenario "AC188 Scope: an Organization board of an archived project is listed nowhere" */
    it("still reaches it from the archived project that owns it", async () => {
      const sharedBoard = await shared();
      const home: BoardReach = {
        projectId: backend.otherProjectId(),
        organization: { organizationId: backend.organizationId(), liveProjectIds: [] },
      };

      const listed = await backend.boards().findBoards(home);

      expect(listed.map((row) => row.id)).toEqual([sharedBoard.id]);
    });

    /** @scenario "AC173 Scope: an Organization board is read-only outside the project that owns it" */
    it("refuses a write that names it from the project that does not own it", async () => {
      const boards = backend.boards();
      const sharedBoard = await shared();
      const stolen = { projectId: backend.projectId(), dashboardId: sharedBoard.id };

      await expect(boards.updateBoard({ ...stolen, data: { name: "Stolen" } })).rejects.toThrow(
        Error,
      );
      await expect(boards.deleteBoard(stolen)).rejects.toThrow(Error);
      await expect(
        boards.findBoardsByIds({ ...reach(), dashboardIds: [sharedBoard.id] }),
      ).resolves.toHaveLength(1);
    });

    /** @scenario "AC176 Scope: a narrower scope keeps other members' stars" */
    it("keeps one star under the owning project, listed in each project that shares it", async () => {
      const boards = backend.boards();
      const own = await board("Own");
      const sharedBoard = await shared();
      const owner = backend.otherProjectId();
      await boards.addStar({
        projectId: backend.projectId(),
        userId: "u",
        star: boardStar(own.id),
      });
      await boards.addStar({
        projectId: owner,
        userId: "u",
        star: boardStar(sharedBoard.id),
        listedInProjectId: backend.projectId(),
      });

      const listed = await boards.findStarred({
        projectId: backend.projectId(),
        userId: "u",
        sharedProjectIds: [owner],
      });

      expect(listed.map((row) => (row.kind === "board" ? row.dashboard.id : row.kind))).toEqual([
        own.id,
        sharedBoard.id,
      ]);
      await expect(
        boards.findStarredDashboardIds({ projectId: owner, userId: "u" }),
      ).resolves.toEqual([sharedBoard.id]);
      await expect(
        boards.findStarred({ projectId: backend.projectId(), userId: "u" }),
      ).resolves.toHaveLength(1);
    });

    /** @scenario "AC176 Scope: a narrower scope keeps other members' stars" */
    it("reorders a shared board's star with the project's own", async () => {
      const boards = backend.boards();
      const own = await board("Own");
      const sharedBoard = await shared();
      const owner = backend.otherProjectId();
      const stars = [own, sharedBoard].map((row) => boardStar(row.id));
      await boards.addStar({ projectId: backend.projectId(), userId: "u", star: stars[0]! });
      await boards.addStar({
        projectId: owner,
        userId: "u",
        star: stars[1]!,
        listedInProjectId: backend.projectId(),
      });
      const mine = { projectId: backend.projectId(), userId: "u", sharedProjectIds: [owner] };

      await boards.reorderStars({ ...mine, stars: stars.toReversed() });

      await expect(boards.findStarredDashboardIds(mine)).resolves.toEqual([sharedBoard.id, own.id]);
    });

    /** @scenario "AC188 Scope: an Organization board of an archived project is listed nowhere" */
    it("leaves a star on it out of a list whose shared projects do not name its owner", async () => {
      const boards = backend.boards();
      const own = await board("Own");
      const sharedBoard = await shared();
      const owner = backend.otherProjectId();
      await boards.addStar({
        projectId: backend.projectId(),
        userId: "u",
        star: boardStar(own.id),
      });
      await boards.addStar({
        projectId: owner,
        userId: "u",
        star: boardStar(sharedBoard.id),
        listedInProjectId: backend.projectId(),
      });
      const mine = { projectId: backend.projectId(), userId: "u", sharedProjectIds: [] };

      const starred = await boards.findStarred(mine);

      expect({
        starred: starred.map((row) => (row.kind === "board" ? row.dashboard.id : row.kind)),
        ids: await boards.findStarredDashboardIds(mine),
        atHome: await boards.findStarredDashboardIds({ projectId: owner, userId: "u" }),
      }).toEqual({ starred: [own.id], ids: [own.id], atHome: [sharedBoard.id] });
    });

    /** @scenario "AC179 Scope change: it asks first only when someone loses the board" */
    it("counts the members other than one who starred a board", async () => {
      const boards = backend.boards();
      const created = await board();
      for (const userId of ["author", "v", "w"]) {
        await boards.addStar({
          projectId: backend.projectId(),
          userId,
          star: boardStar(created.id),
        });
      }

      await expect(
        boards.countOtherStars({
          projectId: backend.projectId(),
          dashboardId: created.id,
          userId: "author",
        }),
      ).resolves.toBe(2);
    });
  });

  describe("when a member stars boards", () => {
    const starred = (userId: string) =>
      backend
        .boards()
        .findStarred({ projectId: backend.projectId(), userId })
        .then((rows) =>
          rows.map((row) =>
            row.kind === "board" ? row.dashboard.id : `template:${row.templateId}`,
          ),
        );
    const star = (userId: string, dashboardId: string) =>
      backend
        .boards()
        .addStar({ projectId: backend.projectId(), userId, star: boardStar(dashboardId) });
    const starTemplate = (userId: string, templateId: string) =>
      backend.boards().addStar({
        projectId: backend.projectId(),
        userId,
        star: { kind: "template", templateId },
      });

    /** @scenario "The memory and Postgres dashboard repositories answer alike" */
    it("appends each star after the last and ignores a repeat", async () => {
      const [a, b, c] = [await board("A"), await board("B"), await board("C")];

      await star("u", c.id);
      await star("u", a.id);
      await star("u", c.id);
      await star("u", b.id);

      await expect(starred("u")).resolves.toEqual([c.id, a.id, b.id]);
    });

    it("keeps one member's stars apart from another's, and in this project only", async () => {
      const a = await board();

      await star("u", a.id);

      await expect(starred("u")).resolves.toEqual([a.id]);
      await expect(starred("v")).resolves.toEqual([]);
      await expect(
        backend
          .boards()
          .findStarredDashboardIds({ projectId: backend.otherProjectId(), userId: "u" }),
      ).resolves.toEqual([]);
    });

    it("removes a star and leaves the others in order", async () => {
      const [a, b, c] = [await board("A"), await board("B"), await board("C")];
      for (const row of [a, b, c]) await star("u", row.id);

      await backend.boards().removeStar({
        projectId: backend.projectId(),
        userId: "u",
        star: boardStar(b.id),
      });

      await expect(starred("u")).resolves.toEqual([a.id, c.id]);
    });

    it("reorders template and board stars together, leaving another member's alone", async () => {
      const [a, b] = [await board("A"), await board("B")];
      await star("u", a.id);
      await starTemplate("u", "t1");
      await star("u", b.id);
      await star("other", a.id);

      await backend.boards().reorderStars({
        projectId: backend.projectId(),
        userId: "u",
        stars: [boardStar(b.id), { kind: "template", templateId: "t1" }, boardStar(a.id)],
      });

      await expect(starred("u")).resolves.toEqual([b.id, "template:t1", a.id]);
      await expect(starred("other")).resolves.toEqual([a.id]);
    });

    it("keeps template stars out of the starred board ids and removes one alone", async () => {
      const a = await board();
      await star("u", a.id);
      await starTemplate("u", "llm-costs");
      await starTemplate("u", "llm-costs");

      await expect(starred("u")).resolves.toEqual([a.id, "template:llm-costs"]);
      await expect(
        backend.boards().findStarredDashboardIds({ projectId: backend.projectId(), userId: "u" }),
      ).resolves.toEqual([a.id]);

      await backend.boards().removeStar({
        projectId: backend.projectId(),
        userId: "u",
        star: { kind: "template", templateId: "llm-costs" },
      });

      await expect(starred("u")).resolves.toEqual([a.id]);
    });
  });

  describe("when a board is deleted from the Dashboards area", () => {
    const projectId = () => backend.projectId();
    const reportsBoard = async (name: string, boardId = id("dash")) => {
      const created = await backend
        .dashboards()
        .createDashboard({ id: boardId, projectId: projectId(), name, order: 0 });
      const graph = await backend.dashboards().createGraph({
        id: id("graph"),
        projectId: projectId(),
        name: "Latency",
        graph: { type: "line" },
        filters: {},
        dashboardId: created.id,
        layout: LAYOUT,
      });
      return { board: created, graph };
    };
    /** The same board in both areas under one id, as the split copied a mixed one. */
    const mixedBoard = async () => {
      const reports = await reportsBoard("Mixed");
      await backend
        .boards()
        .createBoard({ id: reports.board.id, projectId: projectId(), name: "Mixed" });
      await backend.seedStaleCopy({
        id: id("widget"),
        projectId: projectId(),
        dashboardId: reports.board.id,
      });
      return reports;
    };
    const reportsArea = async () => ({
      boards: (
        await backend
          .dashboards()
          .findAllDashboards({ projectId: projectId(), graphKinds: ["builder"] })
      ).map((row) => [row.id, row.graphCount]),
      graphs: (await backend.dashboards().findAllGraphs({ projectId: projectId() })).map(
        (row) => row.id,
      ),
    });

    /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
    it("deletes the board, its widgets, its stars and its stale srcdoc rows, and nothing of Reports", async () => {
      const boards = backend.boards();
      const mixed = await mixedBoard();
      const reports = await reportsBoard("Reports only");
      const other = await board("Other");
      const [onMixed, onOther, unplaced] = [
        await widget(mixed.board.id),
        await widget(other.id),
        await widget(),
      ];
      const staleOnMixed = await backend.findStaleCopyIds(projectId());
      await backend.seedStaleCopy({
        id: onOther.id,
        projectId: projectId(),
        dashboardId: other.id,
      });
      for (const userId of ["u", "v"]) {
        await boards.addStar({ projectId: projectId(), userId, star: boardStar(mixed.board.id) });
        await boards.addStar({ projectId: projectId(), userId, star: boardStar(other.id) });
      }
      const before = await reportsArea();

      await expect(
        boards.deleteBoard({ projectId: projectId(), dashboardId: mixed.board.id }),
      ).resolves.toMatchObject({ id: mixed.board.id });

      expect({
        boards: (await boards.findBoards({ projectId: projectId() })).map((row) => row.id),
        widgets: (await backend.widgets().findAll({ projectId: projectId() }))
          .map((row) => row.id)
          .toSorted(),
        stars: await boards.findStarredDashboardIds({ projectId: projectId(), userId: "v" }),
        stale: await backend.findStaleCopyIds(projectId()),
        reports: await reportsArea(),
      }).toEqual({
        boards: [other.id],
        widgets: [onOther.id, unplaced.id].toSorted(),
        stars: [other.id],
        stale: [onOther.id],
        reports: before,
      });
      expect({ staleOnMixed, onMixed: onMixed.dashboardId, before }).toEqual({
        staleOnMixed: [expect.any(String)],
        onMixed: mixed.board.id,
        before: {
          boards: expect.arrayContaining([
            [mixed.board.id, 1],
            [reports.board.id, 1],
          ]),
          graphs: expect.arrayContaining([mixed.graph.id, reports.graph.id]),
        },
      });
    });

    /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
    it("deletes the stale Dashboard row of a board holding no Reports chart, so Reports lists no copy", async () => {
      const created = await backend
        .dashboards()
        .createDashboard({ id: id("dash"), projectId: projectId(), name: "Widgets", order: 0 });
      await backend
        .boards()
        .createBoard({ id: created.id, projectId: projectId(), name: "Widgets" });
      await backend.seedStaleCopy({
        id: id("widget"),
        projectId: projectId(),
        dashboardId: created.id,
      });

      await backend.boards().deleteBoard({ projectId: projectId(), dashboardId: created.id });

      // Gone from DashboardsV2, the copy would show in Reports again had its row been kept.
      expect({
        reports: await backend
          .dashboards()
          .findDashboards({ projectId: projectId(), dashboardIds: [created.id] }),
        stale: await backend.findStaleCopyIds(projectId()),
      }).toEqual({ reports: [], stale: [] });
    });

    /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
    it("refuses the id of a board only Reports holds, and keeps that board and its charts", async () => {
      const reports = await reportsBoard("Reports only");
      const before = await reportsArea();

      await expect(
        backend.boards().deleteBoard({ projectId: projectId(), dashboardId: reports.board.id }),
      ).rejects.toThrow(Error);

      await expect(reportsArea()).resolves.toEqual(before);
    });

    /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
    it("deletes a widget with its stale srcdoc copy, and no other row", async () => {
      const created = await board();
      const [gone, kept] = [await widget(created.id), await widget(created.id)];
      for (const row of [gone, kept]) {
        await backend.seedStaleCopy({
          id: row.id,
          projectId: projectId(),
          dashboardId: created.id,
        });
      }

      await backend.widgets().deleteWidget({ id: gone.id, projectId: projectId() });

      expect({
        widgets: (await backend.widgets().findAll({ projectId: projectId() })).map((row) => row.id),
        stale: await backend.findStaleCopyIds(projectId()),
      }).toEqual({ widgets: [kept.id], stale: [kept.id] });
    });
  });
}

describe("given the memory board repository", () => {
  contractCases(memoryBackend());
});

describe.skipIf(!databaseUrl)("given the Postgres board repository", () => {
  const backend = postgresBackend(`board-contract-${randomUUID()}`);
  contractCases(backend);

  /** @scenario "AC199b Split: a Dashboards delete removes the board and its stale copy, and keeps every Reports chart" */
  it("leaves the Reports chart's Trigger and its sent alert untouched when a mixed board is deleted", async () => {
    const projectId = backend.projectId();
    const reports = await backend
      .dashboards()
      .createDashboard({ id: id("dash"), projectId, name: "Mixed", order: 0 });
    const chart = await backend.dashboards().createGraph({
      id: id("graph"),
      projectId,
      name: "Latency",
      graph: { type: "line" },
      filters: {},
      dashboardId: reports.id,
      layout: LAYOUT,
    });
    await backend.boards().createBoard({ id: reports.id, projectId, name: "Mixed" });
    await backend.seedStaleCopy({ id: id("widget"), projectId, dashboardId: reports.id });
    const trigger = await database().trigger.create({
      data: {
        name: "Latency alert",
        projectId,
        action: "SEND_EMAIL",
        actionParams: {},
        filters: {},
        customGraphId: chart.id,
      },
    });
    const sent = await database().triggerSent.create({
      data: { triggerId: trigger.id, customGraphId: chart.id, projectId },
    });
    const alerting = () =>
      Promise.all([
        database().dashboard.findMany({ where: { projectId, id: reports.id } }),
        database().customGraph.findMany({ where: { projectId, id: chart.id } }),
        database().trigger.findMany({ where: { projectId, id: trigger.id } }),
        database().triggerSent.findMany({ where: { projectId, id: sent.id } }),
      ]);
    const before = await alerting();

    await backend.boards().deleteBoard({ projectId, dashboardId: reports.id });

    expect(await alerting()).toEqual(before);
    expect(before.map((rows) => rows.length)).toEqual([1, 1, 1, 1]);
  });
});
