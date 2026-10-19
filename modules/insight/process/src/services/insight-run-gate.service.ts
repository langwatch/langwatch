/**
 * Whether a daily run may start, asked when it starts and never from stored state. The run
 * acts as the person: someone who lost their access since the run was asked for gets no run.
 * ORDER IS THE CONTRACT: the project, the flag, the person, their access, then the board.
 */

import { curatedBoardDefinitionById, templateWidgetId } from "@langwatch/analytics-catalogue";
import type { AuthzApi } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type { InsightRunBoard, InsightRunSkipReason } from "@langwatch/insight-contract";
import { isAggregateProjectKind, type ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

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
  definition: Readonly<{ queries: readonly { sql: string }[] }>;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
}>;

/**
 * The dashboard module's two reads a run makes. Each names the board and the person, so the
 * dashboard module's own scope rules answer both: an Only me board is its author's alone.
 */
type RunBoardReader = {
  assertDashboardWidgetsEnabled(input: { projectId: string }): Promise<void>;
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

export type RunGateResult =
  | Readonly<{
      ok: true;
      /** The board as it is now, its name as a pointer keeps it. */
      board: { id: string; name: string };
      /** The widgets on it, in reading order, each with its stored queries. Never empty. */
      widgets: readonly { id: string; name: string; queries: readonly string[] }[];
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

/** The board and its widgets in reading order, each with its queries; a bare board is skipped. */
function readBoardWith({
  board,
  onBoard,
}: {
  board: { id: string; name: string };
  onBoard: readonly RunBoardWidget[];
}): RunGateResult {
  const widgets = onBoard.toSorted(inReadingOrder).map(({ id, name, definition }) => ({
    id,
    name: pointerName({ name, fallback: id }),
    queries: definition.queries.map((query) => query.sql),
  }));
  if (widgets.length === 0) return skipped("board_empty");
  return {
    ok: true,
    board: { id: board.id, name: pointerName({ name: board.name, fallback: board.id }) },
    widgets,
  };
}

/**
 * A From LangWatch board, read from the catalogue. One no longer offered is unreadable, not
 * deleted: a renamed or retired template turns the schedule off only after the skipped days.
 */
function templateBoardOf({ templateId }: { templateId: string }): RunGateResult {
  const curated = curatedBoardDefinitionById(templateId);
  if (!curated) return skipped("board_unreadable");
  const onBoard = curated.widgets.map(({ key, name, definition, layout }) => ({
    id: templateWidgetId({ templateId, key }),
    name,
    definition,
    dashboardId: null,
    gridColumn: layout.gridColumn,
    gridRow: layout.gridRow,
  }));
  return readBoardWith({ board: { id: templateId, name: curated.name }, onBoard });
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
    try {
      if (board.kind === "template") {
        return await this.readTemplateBoard({ projectId, templateId: board.id });
      }
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
    if (!mayRead) return "no_access";
    const mayAsk = await authz.hasProjectPermission({
      userId,
      projectId,
      permission: LANGY_ASK_PERMISSION,
    });
    return mayAsk ? void 0 : "langy_off";
  }

  /** Read as a stored board's widgets are: refused alike while widgets are off for the project. */
  private async readTemplateBoard({
    projectId,
    templateId,
  }: {
    projectId: string;
    templateId: string;
  }): Promise<RunGateResult> {
    await this.members.dashboards.assertDashboardWidgetsEnabled({ projectId });
    return templateBoardOf({ templateId });
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
    const stored = await dashboards.getBoard({ projectId, dashboardId, viewer });
    // Asked by board: the dashboard module then reads an Organization board's own project.
    const onBoard = await dashboards.listDashboardWidgets({
      projectId,
      dashboardId: stored.id,
      viewer,
    });
    return readBoardWith({
      board: stored,
      onBoard: onBoard.filter((widget) => widget.dashboardId === stored.id),
    });
  }
}
