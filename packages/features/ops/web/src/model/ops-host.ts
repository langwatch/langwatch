/**
 * What the Ops screens ask of the application they are mounted in.
 *
 * A screen may not import the router, a toast singleton or the session client:
 * those are the imports ADR-004 seals off from a feature-web package, and
 * reaching for any of them is also what makes a screen untestable outside a
 * running application. They ask this port instead, and the frontend feature
 * that owns them — `apps/ui/src/features/ops` — answers it by adapting the
 * browser capabilities the application already resolves.
 *
 * It lives in `model` because it is a package-wide portable value: types plus
 * the React context they travel in, depending on nothing but React. Every layer
 * above may read it, which is the point — a confirm dialog four levels down a
 * queue table needs the same `failed` notice the screen does.
 *
 * THE FIFTH PORT OF THIS SHAPE (governance, gateway, personal-workspace,
 * automations, ops). The comment on `GatewayHostPort` said a third repeat was
 * the signal to promote them and it has now fired three times; promotion is a
 * change to five packages and is still not something a page move should smuggle
 * in.
 *
 * What Ops asks that no earlier family did: TWO access answers rather than one
 * permission. `platform/app` gated the workspace on a live `ops.getScope` probe
 * and the Backoffice on a separate `user.isAdmin` read, deliberately decoupled
 * so that widening ops access can never widen Backoffice. Both are modelled
 * here as questions, and `apps/ui` answers them from the session capability's
 * platform-tier grants — `ops:view` for the workspace, `ops:manage` for the
 * Backoffice — which is the same two-tier distinction the permission registry
 * already declares (`ops.actions = ["view", "manage"]`, scope `platform`).
 */

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
export abstract class OpsHostPort {
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

  /**
   * The whole address, path and query and fragment, as one string.
   *
   * Beyond what {@link route} answers because Deja View keeps its entire
   * workspace — the searched query, the selected aggregate, the event cursor,
   * the chosen projection — in the URL FRAGMENT, which no params-and-query
   * reading carries. It is read once to seed that state and written back by the
   * workspace itself through `history.replaceState`, which is the same thing it
   * did in `platform/app`.
   */
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

const OpsHostContext = createContext<OpsHostPort | undefined>(void 0);

/** Publishes the host to every Ops screen below it. */
export const OpsHostProvider = OpsHostContext.Provider;

/**
 * The application this screen is running in.
 *
 * Missing means the screen was mounted outside its frontend feature, which is a
 * composition fault rather than something the screen can degrade around.
 */
export function useOpsHost(): OpsHostPort {
  const host = useContext(OpsHostContext);
  if (!host) {
    throw new Error(
      "No ops host is mounted above this screen; render it inside the ops frontend feature.",
    );
  }
  return host;
}
