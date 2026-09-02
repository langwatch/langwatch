import type { AuthzPermission } from "@langwatch/authz-contract";

/** The scope a virtual key is reachable from, as the key's own rows spell it. */
export type GatewayPermissionScope =
  | { type: "org"; id: string }
  | { type: "team"; id: string }
  | { type: "project"; id: string; teamId: string };

/**
 * The one authorization seam the virtual-key write paths decide on.
 *
 * Two questions rather than one, because the two credentials answer them
 * differently and collapsing them would let a scoped API key inherit the
 * user's full cascade: a browser session resolves through the role-binding
 * cascade, while a scoped API key resolves through its own ceiling
 * (`effective = key ∩ user`). A legacy project key is neither and is decided
 * in the service without reaching this port at all.
 */
export abstract class GatewayScopePermissionsPort {
  abstract sessionHolds(input: {
    userId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean>;

  abstract apiKeyHolds(input: {
    apiKeyId: string;
    userId: string | null;
    organizationId: string;
    permission: AuthzPermission;
    scope: GatewayPermissionScope;
  }): Promise<boolean>;
}
