/**
 * Front-door host port: deployment config and route, not identity wire
 */

import { createContext, useContext } from "react";

/**
 * Deployment's public config, restated not imported (circular dependency break)
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
  NEXTAUTH_PROVIDER: string | undefined;
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
 * Customer words for platform error code; installed seam, not module method
 */
export type AuthErrorExplanation = {
  title: string;
  description?: string;
};

/**
 * Failure as front-door screen knows it; wire message is code slug, words from registry
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
export abstract class AuthHostApi {
  /** The deployment's public configuration. */
  abstract publicEnvironment(): AuthPublicEnvironment;

  /** Where this document is, and what it was opened with. */
  abstract route(): AuthRouteReading;

  /**
   * Reports failure to reader; second channel for app registry and trace id to reach front door
   */
  abstract failed(failure: AuthFailureNotice): void;
}

const AuthHostContext = createContext<AuthHostApi | null>(null);

export const AuthHostProvider = AuthHostContext.Provider;

/** The composition never mounted a host above a front-door screen. */
export class AuthHostUnavailableError extends Error {
  constructor() {
    super(
      "No AuthHostApi is mounted above this screen. " +
        "Wrap it in <AuthHostProvider value={host}>.",
    );
    this.name = "AuthHostUnavailableError";
  }
}

/** The host this screen is mounted in. Throws rather than guessing. */
export function useAuthHost(): AuthHostApi {
  const host = useContext(AuthHostContext);
  if (!host) throw new AuthHostUnavailableError();
  return host;
}

/**
 * The host, or nothing — for modules that have a correct answer without one:
 * the error alert degrades to the generic line, the fine print to the
 * built-in legal links, so a fragment test needn't compose a whole app.
 */
export function useOptionalAuthHost(): AuthHostApi | null {
  return useContext(AuthHostContext);
}
