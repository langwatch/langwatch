/**
 * What other modules may read of workflow's host actions. The slice lives in
 * the global UI store as `workflow:host`; workflow's host mount publishes it,
 * any module reads it (ARCHITECTURE §10.2).
 */

export const WORKFLOW_HOST_SLICE = "workflow:host";

/** Where a drawer's content registers actions into the studio drawer's footer slot. */
export const WORKFLOW_DRAWER_FOOTER_SLICE = "workflow:drawer-footer";

/** The project the current page is about, including fields added for the optimization studio. */
export type WorkflowScope = {
  projectId: string | undefined;
  projectSlug: string | undefined;
  /** The project's display name, for the places that title something with it. */
  projectName?: string | undefined;
  organizationId?: string | undefined;
  teamId?: string | undefined;
  /** False while the composing application is still resolving the scope. */
  isResolved?: boolean;
};

/** What a replicate dialog asks of a target: main graded workflows and experiments apart. */
export type WorkflowCopyPermission = "workflows:create" | "evaluations:manage";

/** One project the reader may replicate a workflow into. */
export type WorkflowCopyTarget = {
  id: string;
  /** "Organization / Team / Project", as the select renders it. */
  name: string;
  /** Whether the reader may create in it; a closed target is greyed, not hidden. */
  canCreate: boolean;
};

/** The one way out a failure offers; rendered as a button on the notice. */
export type WorkflowFailureAction = {
  label: string;
  run: () => void;
};

/** A failure, as a screen knows it. `fallbackTitle` names the action that failed. */
export type WorkflowFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  /** The single fix this failure offers, rendered as a button on the notice. */
  action?: WorkflowFailureAction;
  id?: string;
};

/** A short confirmation of something the reader just did. */
export type WorkflowSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/** The path parameters and query string the screen was opened with. */
export type WorkflowRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  /** The matched route path, e.g. `/:project/studio/:workflow`. */
  pathname?: string;
};

/** The state of `workflow:host`: the actions a workflow screen asks of the application. */
export interface WorkflowHostSlice {
  /** The project this page is about. */
  scope(): WorkflowScope;
  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  hasPermission(permission: string): boolean;
  /** Every project the reader could replicate a workflow into. */
  copyTargets(input: { permission: WorkflowCopyPermission }): readonly WorkflowCopyTarget[];
  route(): WorkflowRouteReading;
  /** Merges into the query string; a key set to `undefined` is a key removed. */
  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;
  /** Goes to an address this application serves, the studio after a create. */
  navigate(to: string): void;
  /** Steps back one entry in the reader's own history. */
  back(): void;
  succeeded(notice: WorkflowSuccessNotice): void;
  failed(failure: WorkflowFailureNotice): void;
}
