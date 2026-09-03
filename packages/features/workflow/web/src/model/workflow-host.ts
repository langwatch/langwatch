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

/**
 * The project the current page is about.
 *
 * FOUR FIELDS WERE ADDED FOR THE OPTIMIZATION STUDIO, and they are additions
 * rather than a second port because they are the same question: fifty-six
 * modules in the studio's closure asked the application's
 * `useOrganizationTeamProject` for the scope, and between all of them they read
 * the project, the organization, the team and whether the answer had settled.
 * Everything else that hook resolves — the demo project, the external-member
 * permission table, the onboarding redirect — is the application's own business
 * and stayed there.
 *
 * `isResolved` is the tri-state the studio actually needs: a screen that treats
 * "still arriving" as "no project" renders an empty studio over a workflow that
 * is about to load.
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
 * A failure, as a screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error IS its code slug since #5984, so a screen that
 * wrote its own copy would print the slug at the customer. `fallbackTitle`
 * names the action that failed.
 */
/**
 * The one way out a failure offers.
 *
 * `run` rather than `onClick`: a port says what happens, and the application's
 * toaster turns it into a click. The studio's component alert is why this
 * exists — it used to render a "Go to component" button inside a `description`
 * node, which the feedback capability takes as text and dropped on the floor.
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
 * The path parameters and query string the screen was opened with.
 *
 * `pathname` was added for the studio: its drawer navigation composes an
 * address out of the current one, and ninety-odd of its call sites read
 * `router.pathname` or `router.asPath` off the compat shim that no longer
 * travels with them.
 */
export type WorkflowRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
  /** The matched route path, e.g. `/:project/studio/:workflow`. */
  pathname?: string;
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

  /**
   * Steps back one entry in the reader's own history.
   *
   * Added for the studio, which offers a way out of a dead end and out of a
   * drawer it opened. A host with no history to step back through may make this
   * a no-op; nothing in the family treats it as a navigation that must land.
   */
  abstract back(): void;

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
/**
 * The host, or nothing.
 *
 * For the handful of things that are still correct without one: a link is an
 * anchor whether or not a router is listening, and refusing to render it would
 * turn a missing composition into a blank page rather than a slower navigation.
 */
export function useOptionalWorkflowHost(): WorkflowHostPort | undefined {
  return useContext(WorkflowHostContext);
}

export function useWorkflowHost(): WorkflowHostPort {
  const host = useContext(WorkflowHostContext);
  if (!host) {
    throw new Error(
      "No workflow host is mounted above this screen; render it inside the workflows frontend feature.",
    );
  }
  return host;
}
