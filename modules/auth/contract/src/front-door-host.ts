/** What the shell hands auth's front door and session read: the shapes, not the port. */

/**
 * Deployment's public config, restated not imported (circular dependency break)
 */
export type AuthPublicEnvironment = Readonly<{
  BASE_HOST: string;
  DEMO_PROJECT_SLUG: string | undefined;
  NODE_ENV: "development" | "test" | "production";
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
  /** `invite_only` when accounts on this installation are created by invitation. */
  SIGN_UP_MODE: "open" | "invite_only";
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

/**
 * As much of the auth client as a session read uses — structural, so the
 * real client satisfies it without a cast and a test can fake it.
 */
export type UiAuthClient = {
  $fetch: (path: string) => Promise<{ data?: unknown; error?: unknown }>;
  /**
   * Ends the session. Declared here because this client is the ONE
   * identity instance in the document — a governed web package may not
   * construct its own (`frontend-ui-boundaries` names `better-auth`).
   */
  signOut: () => Promise<unknown>;
};
