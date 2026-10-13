/**
 * The Auth0 connection bridge (D09, deliberately short-term): on SaaS each brokered social
 * connection is its own branded sign-in method, dialling Auth0 pre-scoped to that connection.
 * A natively mounted provider takes its bridge slot, which is that provider's cutover.
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

/** The bridge's rail ids in order, each replaced by its native method where that one is mounted. */
export function auth0BridgeRailIds({
  mountedSocialMethodIds,
}: {
  mountedSocialMethodIds: readonly string[];
}): readonly string[] {
  return AUTH0_BRIDGE_METHODS.map((method) =>
    mountedSocialMethodIds.includes(method.nativeMethodId)
      ? method.nativeMethodId
      : method.methodId,
  );
}
