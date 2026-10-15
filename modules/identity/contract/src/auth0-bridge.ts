/**
 * The Auth0 broker: on cloud it serves only organizations still on legacy Auth0 SSO, reached by
 * domain routing, so the sign-in rail draws neither it nor its social connections. The branded
 * method ids below survive only so a dial already holding one still reaches Auth0.
 */

/** An Auth0 social connection: its strategy, and the native provider it stands in for. */
export interface Auth0SocialStrategy {
  strategy: string;
  nativeProviderId: string;
}

export const AUTH0_SOCIAL_STRATEGIES: readonly Auth0SocialStrategy[] = [
  { strategy: "google-oauth2", nativeProviderId: "google" },
  { strategy: "github", nativeProviderId: "github" },
  { strategy: "windowslive", nativeProviderId: "microsoft" },
];

/** A branded bridge method: the id the rail draws, the connection it dials, its native twin. */
export interface Auth0BridgeMethod {
  methodId: string;
  connection: string;
  nativeMethodId: string;
}

const nativeMethodIdOf = (nativeProviderId: string): string =>
  nativeProviderId === "microsoft" ? "azure-ad" : nativeProviderId;

export const AUTH0_BRIDGE_METHODS: readonly Auth0BridgeMethod[] = AUTH0_SOCIAL_STRATEGIES.map(
  (row) => ({
    methodId: `auth0-${row.nativeProviderId}`,
    connection: row.strategy,
    nativeMethodId: nativeMethodIdOf(row.nativeProviderId),
  }),
);

/**
 * Whether the named provider is only the broker for legacy SSO organizations, never a way in from
 * the rail: Auth0 on cloud. A self-hosted install naming Auth0 still has it as its front door.
 */
export function namedProviderServesOnlyLegacySso({
  authProvider,
  selfHosted,
}: {
  authProvider: string | undefined;
  selfHosted: boolean;
}): boolean {
  return authProvider === "auth0" && !selfHosted;
}
