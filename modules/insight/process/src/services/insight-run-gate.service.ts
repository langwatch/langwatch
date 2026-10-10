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

import { pointerName } from "../rules/insight-daily-run.rules.ts";
import type { InsightRolloutService } from "./insight-rollout.service.ts";

/** What reading a board needs to be allowed: the permission its screen asks for. */
const BOARD_READ_PERMISSION = "analytics:view";

type Viewer = Readonly<{ userId: string }>;

type RunBoardWidget = Readonly<{
  id: string;
  name: string;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
}>;

/** The dashboard module's two reads a run makes, each as the person the run is for. */
type RunBoardReader = {
  getById(input: {
    projectId: string;
    dashboardId: string;
    viewer: Viewer;
  }): Promise<{ id: string; name: string }>;
  listDashboardWidgets(input: {
    projectId: string;
    viewer: Viewer;
  }): Promise<readonly RunBoardWidget[]>;
};

export type RunGateResult =
  | Readonly<{
      ok: true;
      /** The board as it is now, its name as a pointer keeps it. */
      board: { id: string; name: string };
      /** The widgets on it, in reading order. Never empty. */
      widgets: readonly { id: string; name: string }[];
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
 * The dashboard module's refusals that end a run. `board_unreadable`: dashboards, or the
 * custom charts on them, are off for the project.
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
    const refusal = await this.refusalOf({ projectId, userId });
    if (refusal) return skipped(refusal);
    // A From LangWatch board is defined in the browser alone: no server can read its widgets.
    if (board.kind === "template") return skipped("template_board");
    try {
      return await this.readBoard({ projectId, dashboardId: board.id, viewer: { userId } });
    } catch (error) {
      const reason = BOARD_REFUSALS[HandledError.isHandled(error) ? error.code : ""];
      if (!reason) throw error;
      return skipped(reason);
    }
  }

  /** Why this person gets no run in this project now; undefined when they may have one. */
  private async refusalOf({
    projectId,
    userId,
  }: {
    projectId: string;
    userId: string;
  }): Promise<InsightRunSkipReason | undefined> {
    const { rollout, projects, users, authz } = this.members;
    const project = await projects.findById(projectId);
    if (!project || project.archivedAt !== null || isAggregateProjectKind(project.kind)) {
      return "project_unavailable";
    }
    if (!(await rollout.isEnabled({ projectId }))) return "flag_off";
    const user = await users.findById({ id: userId });
    if (!user) return "user_missing";
    if (user.deactivatedAt !== null) return "no_access";
    const mayRead = await authz.hasProjectPermission({
      userId,
      projectId,
      permission: BOARD_READ_PERMISSION,
    });
    return mayRead ? void 0 : "no_access";
  }

  private async readBoard({
    projectId,
    dashboardId,
    viewer,
  }: {
    projectId: string;
    dashboardId: string;
    viewer: Viewer;
  }): Promise<RunGateResult> {
    const { dashboards } = this.members;
    const stored = await dashboards.getById({ projectId, dashboardId, viewer });
    const widgets = (await dashboards.listDashboardWidgets({ projectId, viewer }))
      .filter((widget) => widget.dashboardId === stored.id)
      .toSorted(inReadingOrder)
      .map(({ id, name }) => ({ id, name: pointerName({ name, fallback: id }) }));
    if (widgets.length === 0) return skipped("board_empty");
    return {
      ok: true,
      board: { id: stored.id, name: pointerName({ name: stored.name, fallback: stored.id }) },
      widgets,
    };
  }
}
