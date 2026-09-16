/**
 * A port interface for the evaluators screen — it cannot import
 * @langwatch/ui, the router, or singleton clients (ADR-004). Also asks for
 * openOverlay for drawer registration outside the page-family hierarchy.
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
 * A failure, as the screen knows it. The raw `error` travels, never a
 * screen-composed sentence — the wire message of a handled error IS its
 * code slug since #5984. `fallbackTitle` names the action that failed.
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
export abstract class EvaluatorHostApi {
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
   * Asks for an overlay this family does not own, separate from
   * `setQuery`: the screen states WHICH overlay it wants and the
   * application decides how it's addressed, keeping URL conventions out.
   */
  abstract openOverlay(request: EvaluatorOverlayRequest): void;

  abstract succeeded(notice: EvaluatorSuccessNotice): void;
  abstract failed(failure: EvaluatorFailureNotice): void;
}

const EvaluatorHostContext = createContext<EvaluatorHostApi | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const EvaluatorHostProvider = EvaluatorHostContext.Provider;

/**
 * The host this screen is mounted in. Missing means the screen was
 * rendered outside the frontend feature that owns it — a composition
 * fault, not something a screen can degrade around.
 */
export function useEvaluatorHost(): EvaluatorHostApi {
  const host = useContext(EvaluatorHostContext);
  if (!host) {
    throw new Error(
      "No evaluator host is mounted above this screen; render it inside the evaluator frontend feature.",
    );
  }
  return host;
}
