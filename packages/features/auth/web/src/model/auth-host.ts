/**
 * What the front door asks of the application it is mounted in.
 *
 * A screen may not import `@langwatch/ui`, the router, or the composition's
 * own configuration: those are the imports ADR-004 seals off from a
 * feature-web package, and reaching for any of them is also what would make
 * these screens untestable outside a running application. They ask this port
 * instead, and the frontend feature that owns it — `apps/ui/src/features/auth`
 * — answers it by adapting the browser capabilities the application resolves.
 *
 * THE EIGHTEENTH HOST PORT OF THE SAME SHAPE. Every family before this one
 * recorded that a repeat is the signal to promote it into one place, and every
 * one left it, for the same reason: promotion changes packages a page-family
 * move does not own. Recorded again in
 * `dev/docs/plans/ui-family-move-manifests.md`.
 *
 * WHAT THIS FAMILY ASKS THAT NO OTHER DID is the DEPLOYMENT ITSELF. Every
 * other family's screens run behind a session; these run in front of one, and
 * what they may offer — a password form, a passkey, the identifier-first door,
 * the legal fine print — is decided by the deployment's public configuration
 * rather than by a permission. `@langwatch/ui/public-config` is where the
 * application reads it, and a feature package may not import the application,
 * so the resolved values arrive here instead.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY is the identity wire. Signing in,
 * signing up, signing out and reading the session are the front door's own
 * subject, and they travel with it in `behavior/auth-client.tsx` — ONE
 * better-auth browser client for the whole family, built once per document.
 * Handing a client across this port would mean two instances of the same
 * transport over the same cookie, which is the one thing an identity seam must
 * not have.
 */

import { createContext, useContext } from "react";

/**
 * The deployment's public configuration, as the front door reads it.
 *
 * The same fields `@langwatch/ui`'s `PublicEnvironment` carries, restated
 * rather than imported: `apps/ui` imports this package, so this package may
 * not import `apps/ui`. Whoever harvests the public config into a contract
 * deletes this declaration and the adapter stops restating it.
 */
export type AuthPublicEnvironment = Readonly<{
  BASE_HOST: string;
  DEMO_PROJECT_SLUG: string | undefined;
  NODE_ENV: "development" | "test" | "production";
  IDENTITY_FRONT_DOOR: boolean;
  PASSKEYS_ENABLED: boolean;
  HAS_EMAIL_PROVIDER_KEY: boolean;
  IS_SAAS: boolean;
  GATEWAY_BASE_URL: string;
  POSTHOG_KEY: string | undefined;
  POSTHOG_HOST: string | undefined;
  RUM_ENABLED: boolean;
  RUM_SAMPLE_RATIO: number;
  HAS_LANGWATCH_NLP_SERVICE: boolean;
  HAS_LANGEVALS_ENDPOINT: boolean;
  STRIPE_LICENSE_PAYMENT_LINK_URL: string | undefined;
}>;

/** The address a front-door screen is rendering, as data. */
export type AuthRouteReading = {
  /** The path this document is at, without the query string. */
  pathname: string;
  /** The `:id` style segments the matched route captured. */
  params: Readonly<Record<string, string | undefined>>;
  /** The query string, single-valued — the last write of a repeated key wins. */
  query: Readonly<Record<string, string | undefined>>;
};

/**
 * The words a customer reads for a platform error code.
 *
 * The application owns the code-keyed presentation registry
 * (`platform/app/src/features/errors/logic/presentation.ts`, ~90 codes); this
 * package may not import it, and copying it would put the whole product's
 * error copy inside one feature. It is INSTALLED rather than asked for — see
 * `model/error-presentation.ts`, which says why the seam is a module-level one
 * and not a method here.
 */
export type AuthErrorExplanation = {
  title: string;
  description?: string;
};

/**
 * A failure, as a front-door screen knows it.
 *
 * The raw `error` travels, never a sentence the screen composed: since #5984
 * the wire message of a handled error is its code slug, so a screen that wrote
 * its own copy would print the slug at the customer. The words come from the
 * composition's code-keyed presentation registry (ADR-045).
 *
 * `description` is the front door's own channel, and it carries more weight
 * here than anywhere else. A sign-in refusal is usually the auth provider
 * answering rather than a procedure throwing, so there is frequently no code to
 * look up at all — `authFailureMessage` composes the sentence from the
 * provider's answer, and that sentence is what the reader gets when the
 * registry has nothing to say.
 */
export type AuthFailureNotice = {
  error: unknown;
  /** What the reader was doing, for a code the registry does not list. */
  fallbackTitle: string;
  /** A sentence the screen already had, where the registry has none. */
  description?: string;
  /** Dedupes a retried failure onto its own notice rather than stacking. */
  id?: string;
};

/** The one thing a front-door screen is handed. */
export abstract class AuthHostPort {
  /** The deployment's public configuration. */
  abstract publicEnvironment(): AuthPublicEnvironment;

  /** Where this document is, and what it was opened with. */
  abstract route(): AuthRouteReading;

  /**
   * Reports a failure the reader should be told about.
   *
   * The front door raises these from two screens only — sign-in and sign-up,
   * both of which already show the same refusal inline. The toast is the
   * second channel for a reader whose eyes are on the button rather than the
   * top of the card, and routing it here is what lets the application's
   * registry, its trace id and its docs link reach the front door at all.
   */
  abstract failed(failure: AuthFailureNotice): void;
}

const AuthHostContext = createContext<AuthHostPort | null>(null);

export const AuthHostProvider = AuthHostContext.Provider;

/** The composition never mounted a host above a front-door screen. */
export class AuthHostUnavailableError extends Error {
  constructor() {
    super(
      "No AuthHostPort is mounted above this screen. " +
        "Wrap it in <AuthHostProvider value={host}>.",
    );
    this.name = "AuthHostUnavailableError";
  }
}

/** The host this screen is mounted in. Throws rather than guessing. */
export function useAuthHost(): AuthHostPort {
  const host = useContext(AuthHostContext);
  if (!host) throw new AuthHostUnavailableError();
  return host;
}

/**
 * The host, or nothing.
 *
 * For the modules that have a correct answer without one — the error alert
 * degrades to the generic line, the fine print to the built-in legal links —
 * so a suite that renders a fragment in isolation does not have to compose a
 * whole application first.
 */
export function useOptionalAuthHost(): AuthHostPort | null {
  return useContext(AuthHostContext);
}
