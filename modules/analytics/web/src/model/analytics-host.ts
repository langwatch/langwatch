/**
 * What the analytics screens ask of the application they are mounted in.
 *
 * ONE PORT FOR THE WHOLE FAMILY — the eleventh of the shape governance,
 * gateway, me, automations, ops, agents, datasets, model-config, RBAC,
 * annotations and organization each wrote before it. Everything the nine page
 * files used to read off `useOrganizationTeamProject`, `useRouter`,
 * `usePublicEnv`, `useDrawer` and the toaster arrives through these methods,
 * which is what lets six thousand lines of chart move with their
 * `analyticsApi.x.y.useQuery` call sites unchanged.
 *
 * WHAT THIS PORT DOES NOT HAVE, and deliberately: a `pathname`. Nine page keys
 * are eight screens and one of them takes a `mode`, so nothing here has to read
 * the address to find out which page it is. The two things still read off the
 * address are the custom graph's `:id` and the report grid's `?dashboard=`,
 * and the router captured the first as a route PARAMETER.
 *
 * `setQuery` REPLACES THE WHOLE QUERY rather than merging, because every write
 * this family makes is a removal as well as a set: clearing a filter, dropping
 * a keyset cursor that describes a position in the previous result set, and
 * swapping an absolute range for a relative one all mean "these keys are gone".
 * A merging write cannot say that, and the platform hook went to some length
 * with `qs` to work around not being able to.
 */

import { createContext, useContext } from "react";

/** The project every analytics read is scoped to. */
export type AnalyticsHostProject = {
  id: string;
  slug: string;
  name: string;
  /**
   * Whether anything has ever been ingested.
   *
   * The overview page leads with a setup prompt until it has, which is the one
   * thing on these pages that is about the project rather than the range.
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
 * A short confirmation of something the reader just did.
 *
 * The shared feedback capability's shape, unwidened: a title and an optional
 * description, and no action. Nothing this family confirms needs a button.
 */
export type AnalyticsSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as a screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: the words a
 * customer reads are resolved from the error's `code` by the host's
 * presentation registry, and a screen that wrote its own would print the code
 * slug instead (#5984). `fallbackTitle` names the action that failed, so an
 * unrecognised code still says what the reader was doing.
 */
export type AnalyticsFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

export abstract class AnalyticsHostPort {
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

  abstract succeeded(notice: AnalyticsSuccessNotice): void;

  abstract failed(failure: AnalyticsFailureNotice): void;
}

const AnalyticsHostContext = createContext<AnalyticsHostPort | undefined>(void 0);

export const AnalyticsHostProvider = AnalyticsHostContext.Provider;

/** The host the composing application mounted above this screen. */
export function useAnalyticsHost(): AnalyticsHostPort {
  const host = useContext(AnalyticsHostContext);
  if (!host) {
    throw new Error("The analytics screens must be mounted inside an AnalyticsHostProvider.");
  }
  return host;
}
