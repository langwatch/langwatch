/**
 * What the evaluators screen asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package. It asks this port instead, and the frontend feature that owns it —
 * `apps/ui/src/features/evaluator` — answers it by adapting the browser
 * capabilities the application resolves.
 *
 * THE FOURTEENTH HOST PORT OF THE SAME SHAPE. Deferred again, for the reason
 * every family before recorded: promoting the shape changes packages a page
 * move does not own, and doing it inside a page-family move would hide it.
 *
 * WHAT THIS ONE ASKS THAT NO OTHER DID is `openOverlay`. Three of the four
 * things the evaluators page opened — the evaluator editor, the code evaluator
 * editor and the category picker — are drawers REGISTERED IN `platform/app`
 * with thirteen openers between them outside this family, so they do not
 * travel. What travels is the ADDRESS: the screen writes `?drawer.open=…` and
 * the application decides what that means. Under `apps/ui` today it means
 * nothing opens, because the registry is mounted by `DashboardPageBody`, which
 * is chrome a packaged screen has nothing above it to supply. The address is
 * still the right thing to write — it is what makes the overlay come back for
 * free when the chrome layout route lands, and it is what a shared link already
 * means.
 */

import { createContext, useContext } from "react";

/** The project the current page is about. */
export type EvaluatorScope = {
  projectId: string | undefined;
  projectSlug: string | undefined;
};

/** One project the reader may replicate an evaluator into. */
export type EvaluatorCopyTarget = {
  id: string;
  /** "Organization / Team / Project", as the select renders it. */
  name: string;
  /** Whether the reader may create in it; a closed target is greyed, not hidden. */
  canCreate: boolean;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error IS its code slug since #5984, so a screen that
 * wrote its own copy would print the slug at the customer. `fallbackTitle`
 * names the action that failed.
 */
export type EvaluatorFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  description?: string;
  id?: string;
};

/** A short confirmation of something the reader just did. */
export type EvaluatorSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/** An overlay this family does not own, named by the address that opens it. */
export type EvaluatorOverlayRequest = {
  /** The registered drawer's key, e.g. `evaluatorEditor`. */
  drawer: string;
  /** The parameters the drawer reads out of the query string. */
  params?: Readonly<Record<string, string | undefined>>;
};

/** The path parameters and query string the screen was opened with. */
export type EvaluatorRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** The one thing a screen is handed. */
export abstract class EvaluatorHostPort {
  /** The project this page is about. */
  abstract scope(): EvaluatorScope;

  /** Whether the reader holds a grant, answered synchronously and fail-closed. */
  abstract hasPermission(permission: string): boolean;

  /** Every project the reader could replicate an evaluator into. */
  abstract copyTargets(): readonly EvaluatorCopyTarget[];

  abstract route(): EvaluatorRouteReading;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /**
   * Asks for an overlay this family does not own.
   *
   * Separate from `setQuery` on purpose: the screen states WHICH overlay it
   * wants and the application decides how an overlay is addressed, so a change
   * in the drawer registry's URL convention does not reach into a screen.
   */
  abstract openOverlay(request: EvaluatorOverlayRequest): void;

  abstract succeeded(notice: EvaluatorSuccessNotice): void;
  abstract failed(failure: EvaluatorFailureNotice): void;
}

const EvaluatorHostContext = createContext<EvaluatorHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const EvaluatorHostProvider = EvaluatorHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useEvaluatorHost(): EvaluatorHostPort {
  const host = useContext(EvaluatorHostContext);
  if (!host) {
    throw new Error(
      "No evaluator host is mounted above this screen; render it inside the evaluator frontend feature.",
    );
  }
  return host;
}
