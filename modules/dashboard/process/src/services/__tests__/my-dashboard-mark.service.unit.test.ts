/**
 * The `dashboard:mark-my-dashboards` step over the memory twins: each member's first board named
 * My dashboard in each project, made before the mark, is marked theirs.
 * Spec: dashboards-v2.feature.
 */
import { MY_DASHBOARD_NAME } from "@langwatch/dashboard-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { MigrationStepReport } from "@langwatch/upgrade/step";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryBoardRepository } from "../../repositories/memory/memory.board.repository.ts";
import { MemoryDashboardDatabase } from "../../repositories/memory/memory.dashboard.database.ts";
import { MyDashboardMarkService } from "../my-dashboard-mark.service.ts";

const SHOP = "project_shop";
const OPS = "project_ops";

let boards: MemoryBoardRepository;
let saved: MigrationStepReport[];

const projects: Pick<ProjectApi, "listAllIds"> = {
  listAllIds: async (input) => ({
    ids: [OPS, SHOP].filter((id) => !input?.after || id > input.after),
    next: null,
  }),
};

/** A board as an older release stored it: no mark. */
const stored = ({
  id,
  projectId = SHOP,
  name = MY_DASHBOARD_NAME,
  createdById = "member-1",
}: {
  id: string;
  projectId?: string;
  name?: string;
  createdById?: string | null;
}) => boards.createBoard({ id, projectId, name, createdById });

const run = ({
  dryRun = false,
  resumeFrom = null,
}: { dryRun?: boolean; resumeFrom?: MigrationStepReport | null } = {}) =>
  MyDashboardMarkService.create({ repository: boards, projects }).runStep({
    checkpoint: { resumeFrom, save: async ({ report }) => void saved.push(report) },
    dryRun,
    signal: new AbortController().signal,
    log: { info: () => undefined, warn: () => undefined },
  });

const markOf = async (id: string, projectId = SHOP) =>
  (await boards.findBoardsByIds({ projectId, dashboardIds: [id] }))[0]?.myDashboardOfUserId;

beforeEach(() => {
  boards = MemoryBoardRepository.create({ database: MemoryDashboardDatabase.create() });
  saved = [];
});

describe("MyDashboardMarkService", () => {
  describe("given My dashboards made before the mark", () => {
    /** @scenario "My dashboards made before the mark are marked by a background step" */
    it("marks each member's first one in each project, and a second run changes nothing", async () => {
      await stored({ id: "shop-first" });
      await stored({ id: "shop-second" });
      await stored({ id: "ops-first", projectId: OPS });
      await stored({ id: "shop-other-member", createdById: "member-2" });

      const first = await run();
      const second = await run();

      expect({
        marks: [
          await markOf("shop-first"),
          await markOf("shop-second"),
          await markOf("ops-first", OPS),
          await markOf("shop-other-member"),
        ],
        first,
        second,
      }).toEqual({
        marks: ["member-1", null, "member-1", "member-2"],
        first: { marked: 3, wouldMark: 0, dryRun: false },
        second: { marked: 0, wouldMark: 0, dryRun: false },
      });
    });

    /** @scenario "My dashboards made before the mark are marked by a background step" */
    it("leaves a member who has one marked, other names and boards with no maker alone", async () => {
      await boards.createBoard({
        id: "renamed",
        projectId: SHOP,
        name: "Team pulse",
        createdById: "member-1",
        myDashboardOfUserId: "member-1",
      });
      await stored({ id: "named-later" });
      await stored({ id: "reports", name: "Reports" });
      await stored({ id: "anonymous", createdById: null });

      await expect(run()).resolves.toMatchObject({ marked: 0 });
      expect([
        await markOf("named-later"),
        await markOf("reports"),
        await markOf("anonymous"),
      ]).toEqual([null, null, null]);
    });

    it("writes nothing and saves no checkpoint on a dry run", async () => {
      await stored({ id: "shop-first" });

      await expect(run({ dryRun: true })).resolves.toEqual({
        marked: 0,
        wouldMark: 1,
        dryRun: true,
      });
      expect({ mark: await markOf("shop-first"), saved }).toEqual({ mark: null, saved: [] });
    });

    it("resumes after the last project its checkpoint names", async () => {
      await stored({ id: "ops-first", projectId: OPS });
      await stored({ id: "shop-first" });

      await run({ resumeFrom: { afterProjectId: OPS } });

      expect([await markOf("ops-first", OPS), await markOf("shop-first")]).toEqual([
        null,
        "member-1",
      ]);
      expect(saved.at(-1)).toMatchObject({ afterProjectId: SHOP });
    });
  });
});
