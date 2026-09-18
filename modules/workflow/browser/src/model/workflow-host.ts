/**
 * What the Workflows screens ask of the application they are mounted in.
 * Sealed from ADR-004 imports; adapted by apps/ui/src/features/workflows.
 */

import { createContext, useContext } from "react";

/**
 * The project the current page is about, including fields added for the optimization studio.
 */
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

/** One project the reader may replicate a workflow into. */
export type WorkflowCopyTarget = {
  id: string;
  /** "Organization / Team / Project", as the select renders it. */
  name: string;
  /** Whether the reader may create in it; a closed target is greyed, not hidden. */
  canCreate: boolean;
};

/**
 * A failure, as a screen knows it. `fallbackTitle` names the action that failed.
 */

/**
 * The one way out a failure offers; rendered as a button on the notice.
 */
export type WorkflowFailureAction = {
  label: string;
  run: () => void;
};

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

/**
 * The path parameters and query string the screen was opened with. `pathname`
 * was added for the studio, whose call sites still read `router.pathname` or
 * `router.asPath` off the compat shim that no longer travels with them.
 */
export type WorkflowRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  /** The matched route path, e.g. `/:project/studio/:workflow`. */
  pathname?: string;
};

/** The one thing a screen is handed. */
export abstract class WorkflowHostApi {
  /** The project this page is about. */
  abstract scope(): WorkflowScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** Every project the reader could replicate a workflow into. */
  abstract copyTargets(): readonly WorkflowCopyTarget[];

  abstract route(): WorkflowRouteReading;

  /** Merges into the query string; a key set to `undefined` is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /** Goes to an address this application serves — the studio, after a create. */
  abstract navigate(to: string): void;

  /**
   * Steps back one entry in the reader's own history. Added for the studio; a
   * host with no history to step back through may make this a no-op — nothing
   * in the family treats it as a navigation that must land.
   */
  abstract back(): void;

  abstract succeeded(notice: WorkflowSuccessNotice): void;
  abstract failed(failure: WorkflowFailureNotice): void;
}

const WorkflowHostContext = createContext<WorkflowHostApi | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const WorkflowHostProvider = WorkflowHostContext.Provider;

/**
 * The host these screens are mounted in, or nothing.
 */
export function useOptionalWorkflowHost(): WorkflowHostApi | undefined {
  return useContext(WorkflowHostContext);
}

export function useWorkflowHost(): WorkflowHostApi {
  const host = useContext(WorkflowHostContext);
  if (!host) {
    throw new Error(
      "No workflow host is mounted above this screen; render it inside the workflows frontend feature.",
    );
  }
  return host;
}

/** The grant the platform page asked for, unchanged. */
export const WORKFLOWS_PAGE_PERMISSION = "workflows:view";
