import type { AccountIdentifier, RoutingDecision } from "@langwatch/identity-contract";

interface SignInGovernanceDeps {
  identifiers: { listIdentifiers(input: { userId: string }): Promise<AccountIdentifier[]> };
  router: {
    route(input: { identifier: string | null; breakGlass: boolean }): Promise<RoutingDecision>;
  };
}

/**
 * Whether an organization's single sign-on governs this person's sign-in: one of their confirmed
 * addresses routes to an organization connection, as `CredentialSignInPolicyService` asks.
 * Instance federation names no connection, so it governs nobody here.
 */
export class SignInGovernanceService {
  static create(deps: SignInGovernanceDeps): SignInGovernanceService {
    return new SignInGovernanceService(deps);
  }

  private constructor(private readonly deps: SignInGovernanceDeps) {}

  async isGovernedBySso({ userId }: { userId: string }): Promise<boolean> {
    const identifiers = await this.deps.identifiers.listIdentifiers({ userId });
    for (const { provider, confirmed, value } of identifiers) {
      if (provider !== "email" || !confirmed || !value) continue;
      const decision = await this.deps.router.route({ identifier: value, breakGlass: false });
      if (decision.outcome === "redirect_to_connection" && decision.connectionId !== undefined) {
        return true;
      }
    }
    return false;
  }
}
