import { AuthApi } from "@langwatch/auth-contract";
import type { BoundApis } from "@langwatch/process";

/** Every channel bound to a module that identity holds, as the container hands them over. */
export interface IdentityChannels {
  /**
   * Auth's reads: the provider and the social methods it mounted (A1-b; the secrets and the SSO
   * licence stay in auth), the IdP origins it dials, and what its sessions and accounts say (A1-c).
   */
  readonly authReads: Pick<
    AuthApi,
    | "resolveAuthProvider"
    | "findMountedSocialMethodIds"
    | "findDialableIdentityProviderOrigins"
    | "findFederatedAccountProviders"
    | "countLegacySsoAccess"
    | "listBrowserSessions"
    | "findSessionAmr"
    | "findAssertedAmrForIdentifiers"
  >;
}

/**
 * Both tiers bind auth for its reads: a binding to a module is no peer (round 34; round 48,
 * A1-b and A1-c; record §5), so auth may depend on identity.
 */
export class BoundIdentityChannels {
  static readonly requires = [] as const;
  static readonly binds = { authReads: AuthApi } as const;

  static create({
    bound,
  }: {
    bound: BoundApis<typeof BoundIdentityChannels.binds>;
  }): IdentityChannels {
    return { authReads: bound.authReads };
  }
}
