/**
 * What the Workflows screens ask of the application they are mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package. It asks this port instead, and the frontend feature that owns it —
 * `apps/ui/src/features/workflows` — answers it by adapting the browser
 * capabilities the application resolves.
 *
 * THE EIGHTEENTH HOST PORT OF THE SAME SHAPE. Deferred again, for the reason
 * every family before recorded: promoting the shape changes packages a page
 * move does not own, and smuggling it into a page move would hide it.
 *
 * WHAT THIS ONE ASKS THAT NO OTHER DID is nothing at all, which is the point:
 * `scope / hasPermission / copyTargets / route / setQuery / navigate /
 * succeeded / failed` is the evaluator and dataset port written out again. The
 * one difference is that `navigate` is load-bearing here rather than optional —
 * creating a workflow ends by opening the studio at `/:project/studio/:id`, an
 * address `platform/app` still serves.
 */

import { createContext, useContext } from "react";

/** The project the current page is about. */
export type WorkflowScope = {
  projectId: string | undefined;
  projectSlug: string | undefined;
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
 * A failure, as a screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error IS its code slug since #5984, so a screen that
 * wrote its own copy would print the slug at the customer. `fallbackTitle`
 * names the action that failed.
 */
export type WorkflowFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
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
};

/** The one thing a screen is handed. */
export abstract class WorkflowHostPort {
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

  abstract succeeded(notice: WorkflowSuccessNotice): void;
  abstract failed(failure: WorkflowFailureNotice): void;
}

const WorkflowHostContext = createContext<WorkflowHostPort | undefined>(void 0);

/** Publishes the host to the screens and everything they render. */
export const WorkflowHostProvider = WorkflowHostContext.Provider;

/**
 * The host these screens are mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useWorkflowHost(): WorkflowHostPort {
  const host = useContext(WorkflowHostContext);
  if (!host) {
    throw new Error(
      "No workflow host is mounted above this screen; render it inside the workflows frontend feature.",
    );
  }
  return host;
}
