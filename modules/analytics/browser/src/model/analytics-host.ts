/**
 * What analytics screens ask of their host app. No `pathname` — only two
 * screens still read the address. `setQuery` REPLACES the query rather than
 * merging, since a write here often means certain keys are now gone.
 */

import { createContext, useContext } from "react";

/** The project every analytics read is scoped to. */
export type AnalyticsHostProject = {
  id: string;
  slug: string;
  name: string;
  /**
   * Whether anything has ever been ingested. The overview page leads with
   * a setup prompt until it has — the one thing on these pages that is
   * about the project rather than the range.
   */
  hasFirstMessage: boolean;
};

/** The path parameters and query string a screen was opened with. */
export type AnalyticsRouteReading = {
  /** The `:id` style segments the matched route captured. */
  params: Readonly<Record<string, string | undefined>>;
  /** The query string, single-valued — the last write of a repeated key wins. */
  query: Readonly<Record<string, string | undefined>>;
};

/**
 * A short confirmation of something the reader just did: the shared
 * feedback capability's shape, unwidened — title, optional description,
 * no action, since nothing this family confirms needs a button.
 */
export type AnalyticsSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as a screen knows it: the raw `error` travels, never a
 * composed sentence — words are resolved from its `code` by the host's
 * presentation registry (#5984). `fallbackTitle` names the failed action.
 */
export type AnalyticsFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** Alert authoring for one saved graph; `automationId` edits the alert it already has. */
export type AnalyticsAlertAuthoring = {
  graphId: string;
  automationId?: string;
  seriesName?: string;
};

export abstract class AnalyticsHostApi {
  /** The project in scope, or undefined before one resolves. */
  abstract project(): AnalyticsHostProject | undefined;

  /** The organization the project sits in, for reads scoped above a project. */
  abstract organizationId(): string | undefined;

  abstract hasPermission(permission: string): boolean;

  abstract route(): AnalyticsRouteReading;

  /** Replaces the WHOLE query, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  /** Sends the reader somewhere else in the application. */
  abstract navigate(to: string): void;

  /** Opens automation's drawer, which owns alert authoring; analytics never renders it. */
  abstract openAutomationDrawer(request: AnalyticsAlertAuthoring): void;

  abstract succeeded(notice: AnalyticsSuccessNotice): void;

  abstract failed(failure: AnalyticsFailureNotice): void;
}

const AnalyticsHostContext = createContext<AnalyticsHostApi | undefined>(void 0);

export const AnalyticsHostProvider = AnalyticsHostContext.Provider;

/** The host the composing application mounted above this screen. */
export function useAnalyticsHost(): AnalyticsHostApi {
  const host = useContext(AnalyticsHostContext);
  if (!host) {
    throw new Error("The analytics screens must be mounted inside an AnalyticsHostProvider.");
  }
  return host;
}
