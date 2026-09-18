/** Application port for Ops screens (can't import router/toast/session—ADR-004;
 * testability). Package-wide portable value; two access answers (view+manage). */

import { createContext, useContext } from "react";

/**
 * The project the operator is standing in, and the key traces are sent with.
 * Only the Foundry asks for both halves at once, to post a generated trace
 * with the project's own API key.
 */
export type OpsProject = { id: string; apiKey: string };

/** The path parameters and query string the screen was opened with. */
export type OpsRouteReading = {
  params: Readonly<Record<string, string | undefined>>;
  query: Readonly<Record<string, string | undefined>>;
};

/** A short confirmation of something the operator just did. */
export type OpsSuccessNotice = {
  title: string;
  description?: string;
  id?: string;
};

/**
 * A failure, as the screen knows it. `error` travels raw - never a
 * screen-composed sentence, since a handled error's wire message is its
 * code slug. `fallbackTitle` names the action for an unrecognised code.
 */
export type OpsFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * The one thing a screen is handed. Methods rather than loose functions, so
 * the adapter is a class the feature constructs once and a test double is an
 * obvious object literal.
 */
export abstract class OpsHostApi {
  /**
   * Whether the reader may see the Ops workspace at all. Fails closed: an
   * answer that has not arrived reads as no, exactly as the `ops.getScope`
   * probe's `{ kind: "none" }` did while in flight.
   */
  abstract hasOpsAccess(): boolean;

  /**
   * Whether the reader may see the Backoffice, which is strictly narrower.
   * Kept apart from {@link hasOpsAccess}: if ops access ever broadens past
   * operators, the Backoffice must not broaden with it.
   */
  abstract isOpsAdmin(): boolean;

  /**
   * True on a shared (multi-tenant) install. A product flag flipped here
   * reaches every customer, so feature-flag rows carry a fleet-reach warning
   * only when this answers true; false on self-hosted is correct silence.
   */
  abstract sharedInstall(): boolean;

  /** The project this page is about, when the reader is standing in one. */
  abstract project(): OpsProject | undefined;

  abstract route(): OpsRouteReading;

  /** Whole address including fragment; Deja View state lives in URL fragment. */
  abstract asPath(): string;

  /** Replaces the whole query string; a key left out is a key removed. */
  abstract setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void;

  abstract navigate(to: string): void;

  abstract succeeded(notice: OpsSuccessNotice): void;

  abstract failed(failure: OpsFailureNotice): void;
}

const OpsHostContext = createContext<OpsHostApi | undefined>(void 0);

/** Publishes the host to every Ops screen below it. */
export const OpsHostProvider = OpsHostContext.Provider;

/**
 * The application this screen is running in. Missing means it was mounted
 * outside its frontend feature - a composition fault, not something the
 * screen can degrade around.
 */
export function useOpsHost(): OpsHostApi {
  const host = useContext(OpsHostContext);
  if (!host) {
    throw new Error(
      "No ops host is mounted above this screen; render it inside the ops frontend feature.",
    );
  }
  return host;
}
