import type { LangWatchQLCaller, LangWatchQLProtections } from "@langwatch/analytics-contract";

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
