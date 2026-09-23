import type { RoutingDecision } from "@langwatch/identity-contract";

/** Where the proved address signs in, asked of the same router the front door asks. */
export interface CredentialSignInRouting {
  route(input: { identifier: string | null; breakGlass: boolean }): Promise<RoutingDecision>;
}

/** The connection's tenant, from the module that registered the connection. */
export interface CredentialSignInConnections {
  getOrganization(args: { connectionId: string }): Promise<{ organizationId: string }>;
}

/** Who still holds a way back in for an organization whose provider governs it. */
export interface CredentialSignInRecoveryGrants {
  findGrants(args: {
    organizationId: string;
  }): Promise<readonly { userId: string; live: boolean }[]>;
}

export interface CredentialSignInPolicyDeps {
  /** `null` where this process composed no sign-in routing directory: with
   *  nothing to route on, no organization connection can govern an address. */
  routing: CredentialSignInRouting | null;
  connections: CredentialSignInConnections;
  recovery: CredentialSignInRecoveryGrants;
}

/** Authorises an already proved password against its address's current route
 *  (specs/identity/sso-credential-enforcement.feature). Only an organization's
 *  own connection requires a recovery grant; the deployment-wide federation
 *  gate stays the request hook's. */
export class CredentialSignInPolicyService {
  static create(deps: CredentialSignInPolicyDeps): CredentialSignInPolicyService {
    return new CredentialSignInPolicyService(deps);
  }

  private constructor(private readonly deps: CredentialSignInPolicyDeps) {}

  async canSignIn({ userId, email }: { userId: string; email: string }): Promise<boolean> {
    const routing = this.deps.routing;
    if (routing === null) return true;

    const decision = await routing.route({ identifier: email, breakGlass: false });
    if (decision.outcome !== "redirect_to_connection") return true;

    const connectionId = decision.connectionId;
    // Instance federation carries no connection, and is governed by the
    // deployment's own request hook rather than by a recovery grant.
    if (connectionId === undefined) return true;

    const { organizationId } = await this.deps.connections.getOrganization({ connectionId });
    // Eligibility is checked when granting; a later role change does not
    // revoke the holder's existing recovery door.
    const grants = await this.deps.recovery.findGrants({ organizationId });
    return grants.some((grant) => grant.live && grant.userId === userId);
  }
}
