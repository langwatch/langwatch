import { AuthApi } from "@langwatch/auth-contract";
import type { BoundApis } from "@langwatch/process";

/** Every channel bound to a module that user holds, as the container hands them to the class. */
export interface UserChannels {
  /**
   * Auth's reads: the provider and the routing an address signs in through (A1-b; the secrets
   * and the SSO licence stay in auth), and what its sessions and federated accounts say (A1-c).
   */
  readonly authReads: Pick<
    AuthApi,
    "resolveAuthProvider" | "route" | "getSignedInWith" | "getSsoSetupStatus"
  >;
}

/**
 * Both tiers bind auth for its reads: a binding to a module is no peer (round 34; round 48,
 * A1-b and A1-c; record §5), so auth may depend on user.
 */
export class BoundUserChannels {
  static readonly requires = [] as const;
  static readonly binds = { authReads: AuthApi } as const;

  static create({ bound }: { bound: BoundApis<typeof BoundUserChannels.binds> }): UserChannels {
    return { authReads: bound.authReads };
  }
}
