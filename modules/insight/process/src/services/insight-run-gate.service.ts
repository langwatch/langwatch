/**
 * Whether a daily run may start, asked when it starts and never from stored state. The run
 * acts as the person: someone who lost their access since the run was asked for gets no run.
 * ORDER IS THE CONTRACT: the project, the flag, the person, their access, then the board.
 */

import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { InsightRunBoard, InsightRunSkipReason } from "@langwatch/insight-contract";
import { isAggregateProjectKind, type ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { HealthStatement } from "../rules/insight-board-health.rules.ts";
import { pointerName } from "../rules/insight-daily-run.rules.ts";
import type { InsightRolloutService } from "./insight-rollout.service.ts";

/** What reading a board needs to be allowed: the permission its screen asks for. */
const BOARD_READ_PERMISSION = "analytics:view";
/** What asking Langy needs: each run is a turn paid for in LLM calls. */
const LANGY_ASK_PERMISSION = "langy:create";

type Viewer = Readonly<{ userId: string }>;

type RunBoardWidget = Readonly<{
  id: string;
  name: string;
  definition: Readonly<{ queries: readonly HealthStatement[] }>;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
}>;

/**
 * The dashboard module's two reads a run makes. Each names the board and the person, so the
 * dashboard module's own scope rules answer both: an Only me board is its author's alone.
 */
type RunBoardReader = {
  getBoard(input: {
    projectId: string;
    dashboardId: string;
    viewer: Viewer;
  }): Promise<{ id: string; name: string }>;
  listDashboardWidgets(input: {
    projectId: string;
    dashboardId: string;
    viewer: Viewer;
  }): Promise<readonly RunBoardWidget[]>;
};

export type RunGateWidget = Readonly<{
  id: string;
  name: string;
  queries: readonly string[];
  statements: readonly HealthStatement[];
}>;

export type RunGateResult =
  | Readonly<{
      ok: true;
      /** The board as it is now, its name as a pointer keeps it. */
      board: { id: string; name: string };
      /**
       * The widgets on it, in reading order, each with its stored queries, and those queries
       * with the parameters they declare for the board check. Never empty.
       */
      widgets: readonly RunGateWidget[];
      /** Whether the project is a person's own, where a board reads Langy's traces too. */
      isPersonalProject: boolean;
    }>
  | Readonly<{ ok: false; reason: InsightRunSkipReason }>;

type InsightRunGateMembers = Readonly<{
  rollout: Pick<InsightRolloutService, "isEnabled">;
  projects: Pick<ProjectApi, "findById">;
  users: Pick<UserApi, "findById">;
  authz: Pick<AuthzApi, "hasProjectPermission">;
  dashboards: RunBoardReader;
}>;

/**
 * The dashboard module's refusals that end a run. A board the person may not see is refused as
 * `dashboard_not_found`, like one that never existed, so the reason tells them apart from none.
 * `board_unreadable`: dashboards, or the custom charts on them, are off for the project.
 */
const BOARD_REFUSALS: Readonly<Record<string, InsightRunSkipReason>> = {
  dashboard_not_found: "board_deleted",
  dashboards_not_enabled: "board_unreadable",
  custom_chart_playground_not_enabled: "board_unreadable",
};

function skipped(reason: InsightRunSkipReason): RunGateResult {
  return { ok: false, reason };
}

function inReadingOrder(a: RunBoardWidget, b: RunBoardWidget): number {
  return a.gridRow - b.gridRow || a.gridColumn - b.gridColumn || a.id.localeCompare(b.id);
}

export class InsightRunGateService {
  private constructor(private readonly members: InsightRunGateMembers) {}

  static create(members: InsightRunGateMembers): InsightRunGateService {
    return new InsightRunGateService(members);
  }

  async check({
    projectId,
    userId,
    board,
  }: {
    projectId: string;
    userId: string;
    board: InsightRunBoard;
  }): Promise<RunGateResult> {
    const admission = await this.admissionOf({ projectId, userId });
    if (!admission.ok) return skipped(admission.reason);
    // A From LangWatch board is defined in the browser alone: no server can read its widgets.
    if (board.kind === "template") return skipped("template_board");
    try {
      return await this.readBoard({
        projectId,
        dashboardId: board.id,
        viewer: { userId },
        isPersonalProject: admission.isPersonalProject,
      });
    } catch (error) {
      const reason = BOARD_REFUSALS[HandledError.isHandled(error) ? error.code : ""];
      if (!reason) throw error;
      return skipped(reason);
    }
  }

  /** Whether this person may have a run in this project now, and what the project is. */
  private async admissionOf({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<
    | Readonly<{ ok: true; isPersonalProject: boolean }>
    | Readonly<{ ok: false; reason: InsightRunSkipReason }>
  > {
    const project = await this.members.projects.findById(projectId);
    if (!project || project.archivedAt !== null || isAggregateProjectKind(project.kind)) {
      return { ok: false, reason: "project_unavailable" };
    }
    const reason = await this.refusalOf({ projectId, userId });
    return reason ? { ok: false, reason } : { ok: true, isPersonalProject: project.isPersonal };
  }

  /** Why this person gets no run in a project that takes runs; undefined when they may. */
  private async refusalOf({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InsightRunSkipReason | undefined> {
    const { rollout, users, authz } = this.members;
    if (!(await rollout.isEnabled({ projectId }))) return "flag_off";
    const user = await users.findById({ id: userId });
    if (!user) return "user_missing";
    if (user.deactivatedAt !== null) return "no_access";
    const mayRead = await authz.hasProjectPermission({
      userId,
      projectId,
      permission: BOARD_READ_PERMISSION,
    });
    if (!mayRead) return "no_access";
    const mayAsk = await authz.hasProjectPermission({
      userId,
      projectId,
      permission: LANGY_ASK_PERMISSION,
    });
    return mayAsk ? void 0 : "langy_off";
  }

  private async readBoard({
    projectId,
    dashboardId,
    viewer,
    isPersonalProject,
  }: {
    projectId: string;
    dashboardId: string;
    viewer: Viewer;
    isPersonalProject: boolean;
  }): Promise<RunGateResult> {
    const { dashboards } = this.members;
    const stored = await dashboards.getBoard({ projectId, dashboardId, viewer });
    // Asked by board: the dashboard module then reads an Organization board's own project.
    const onBoard = await dashboards.listDashboardWidgets({
      projectId,
      dashboardId: stored.id,
      viewer,
    });
    const widgets = onBoard
      .filter((widget) => widget.dashboardId === stored.id)
      .toSorted(inReadingOrder)
      .map(({ id, name, definition }) => ({
        id,
        name: pointerName({ name, fallback: id }),
        queries: definition.queries.map((query) => query.sql),
        statements: definition.queries,
      }));
    if (widgets.length === 0) return skipped("board_empty");
    return {
      ok: true,
      board: { id: stored.id, name: pointerName({ name: stored.name, fallback: stored.id }) },
      widgets,
      isPersonalProject,
    };
  }
}
