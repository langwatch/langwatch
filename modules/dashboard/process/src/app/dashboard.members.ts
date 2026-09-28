import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { DashboardViewer } from "@langwatch/dashboard-contract";

/**
 * Whether a project may place workbench cards at all. The gate is LangWatchQL's own — a feature
 * flag resolved against the project's organization — so Dashboard takes it as a port the
 * application composes rather than reading Analytics' server package.
 */
export interface WorkbenchAccess {
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
}

export interface WorkbenchCaller {
  /** The member's own content protections for this project. */
  resolveProtections(input: {
    actorId: string;
    projectId: string;
  }): Promise<LangWatchQLProtections>;

  /** The project identity and protections a session-authenticated run uses. */
  resolveRunCaller(input: {
    actorId: string;
    projectId: string;
  }): Promise<Readonly<{ project: LangWatchQLCaller; protections: LangWatchQLProtections }>>;
}

/**
 * The two audience facts visibility needs about a member, asked of the peers
 * that own them: team membership (organization) and admin rights (authz).
 */
export interface DashboardAudience {
  /** Whether the member belongs to the team that owns the project. */
  isTeamMember(input: { projectId: string; userId: string }): Promise<boolean>;
  /** Whether the member administers the project (`project:manage`). */
  isAdmin(input: { projectId: string; userId: string }): Promise<boolean>;
}

/** Which boards a viewer may see, for the blocks placed on them. */
export interface DashboardBoardAudience {
  isVisibleTo(input: {
    projectId: string;
    dashboardId: string;
    viewer?: DashboardViewer;
  }): Promise<boolean>;
  findVisibleDashboardIds(input: {
    projectId: string;
    viewer?: DashboardViewer;
  }): Promise<string[]>;
}

/** The `release_dashboards` rollout, resolved for one project. */
export interface DashboardsRollout {
  isDashboardsEnabled(input: { projectId: string }): Promise<boolean>;
}
