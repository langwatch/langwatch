/**
 * What the Data Privacy screen asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, a toast singleton or the
 * session client: those are the imports ADR-004 seals off from a feature-web
 * package, and reaching for any of them is also what would make this screen
 * untestable outside a running application. It asks this port instead, and the
 * frontend feature that owns it — `apps/ui/src/features/data-privacy` — answers
 * it by adapting the browser capabilities the application already resolves.
 *
 * THE EIGHTH DECLARATION OF THIS SHAPE, and the second in this move. See
 * `DataRetentionHostPort` for why it is still written out rather than promoted.
 *
 * NARROWER THAN ITS SIBLING. Data privacy has no plan gate and no
 * platform-admin capability: every scope the server hands back is writable, so
 * the screen asks only for the scope, the address and the two notices. Nothing
 * is declared here that the screen does not read.
 */

import { createContext, useContext } from "react";

/** The organization, team and project the address is about. */
export type PrivacyHostScope = {
  organizationId: string | undefined;
  teamId: string | undefined;
  projectId: string | undefined;
};

/** The path parameters and query string the screen was opened with. */
export type PrivacyRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the reader just did. */
export type PrivacySuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: the wire
 * message of a handled error is its code slug, so a screen that wrote its own
 * copy would print the slug at the customer. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what the reader was doing.
 */
export type PrivacyFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/** The one thing the screen is handed. */
export abstract class DataPrivacyHostPort {
  /** The organization, team and project this page is about. */
  abstract scope(): PrivacyHostScope;

  abstract route(): PrivacyRouteReading;

  /** The whole next query string, so a screen can remove a key as well as set one. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract succeeded(notice: PrivacySuccessNotice): void;

  abstract failed(failure: PrivacyFailureNotice): void;
}

const DataPrivacyHostContext = createContext<DataPrivacyHostPort | undefined>(void 0);

/** Publishes the host to the screen and everything it renders. */
export const DataPrivacyHostProvider = DataPrivacyHostContext.Provider;

/**
 * The host this screen is mounted in.
 *
 * Missing means the screen was rendered outside the frontend feature that owns
 * it, which is a composition fault rather than something a screen can degrade
 * around.
 */
export function useDataPrivacyHost(): DataPrivacyHostPort {
  const host = useContext(DataPrivacyHostContext);
  if (!host) {
    throw new Error(
      "No Data Privacy host is mounted above this screen; render it inside the data-privacy frontend feature.",
    );
  }
  return host;
}
