import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";
import type { Trigger } from "@langwatch/automation-contract";

export interface DashboardInfrastructure {
  alertRedaction: AlertRedaction;
  platformUrl: PlatformUrl;
  workbenchAccess: WorkbenchAccess;
  workbenchCaller: WorkbenchCaller;
}


export interface AlertRedaction {
  redactActionParams(
    action: Trigger["action"],
    actionParams: Record<string, unknown>,
  ): Record<string, unknown>;
}

/**
 * The address a reader opens a dashboard at. Every `/api/dashboards` answer
 * carries one, and only the deployment knows its own public base URL.
 */
export interface PlatformUrl {
  linkTo(input: { projectSlug: string; path: string }): string;
}

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
