/** Application port for Ops screens (can't import router/toast/session—ADR-004;
 * testability). Package-wide portable value; two access answers (view+manage). */

import { createContext, useContext } from "react";

/**
 * The project the operator is standing in, and the key traces are sent with.
 *
 * Only the Foundry asks for it, and it asks for both halves at once: a
 * generated trace is posted to the ingestion endpoint with the project's own
 * API key, which is the one fact on this port that is not about the address or
 * the session.
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
 * A failure, as the screen knows it.
 *
 * The raw `error` travels and never a sentence the screen composed: since the
 * wire message of a handled error is its code slug, a screen that wrote its own
 * copy would print the slug at the operator. `fallbackTitle` names the action
 * that failed, so an unrecognised code still says what was being done.
 */
export type OpsFailureNotice = {
  error: unknown;
  fallbackTitle: string;
  id?: string;
};

/**
 * The one thing a screen is handed.
 *
 * Methods rather than an object of loose functions, so the adapter is a class
 * the frontend feature constructs once and a test double is an obvious object
 * literal.
 */
export abstract class OpsHostApi {
  /**
   * Whether the reader may see the Ops workspace at all.
   *
   * Fails closed: an answer that has not arrived reads as no, exactly as the
   * `ops.getScope` probe's `{ kind: "none" }` did while it was in flight.
   */
  abstract hasOpsAccess(): boolean;

  /**
   * Whether the reader may see the Backoffice, which is strictly narrower.
   *
   * Kept apart from {@link hasOpsAccess} for the reason the platform shell
   * stated: if ops access ever broadens past operators, the Backoffice must not
   * broaden with it.
   */
  abstract isOpsAdmin(): boolean;

  /**
   * True on a shared (multi-tenant) install. What hangs on it is blast
   * radius: a PRODUCT flag flipped here reaches every customer, so the
   * feature-flag rows carry a fleet-reach warning only when this answers
   * true. Answering false quietly on a self-hosted install is the correct
   * silence, not a failure mode.
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
 * The application this screen is running in.
 *
 * Missing means the screen was mounted outside its frontend feature, which is a
 * composition fault rather than something the screen can degrade around.
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
