import type { AccountIdentifier, RoutingDecision } from "@langwatch/identity-contract";

interface SignInGovernanceDeps {
  identifiers: { listIdentifiers(input: { userId: string }): Promise<AccountIdentifier[]> };
  /** The account's own address: the one a password signs in with, confirmed or not. */
  accountAddress: (args: { userId: string }) => Promise<{ email: string } | null>;
  router: {
    route(input: { identifier: string | null; breakGlass: boolean }): Promise<RoutingDecision>;
  };
}

/**
 * Whether an organization's single sign-on governs this person's sign-in: their account address
 * or a confirmed one routes to an organization connection, as `CredentialSignInPolicyService` asks.
 * Instance federation names no connection, so it governs nobody here.
 */
export class SignInGovernanceService {
  static create(deps: SignInGovernanceDeps): SignInGovernanceService {
    return new SignInGovernanceService(deps);
  }

  private constructor(private readonly deps: SignInGovernanceDeps) {}

  async isGovernedBySso({ userId }: { userId: string }): Promise<boolean> {
    const [identifiers, account] = await Promise.all([
      this.deps.identifiers.listIdentifiers({ userId }),
      this.deps.accountAddress({ userId }),
    ]);
    const addresses = new Set(
      identifiers.flatMap(({ provider, confirmed, value }) =>
        provider === "email" && confirmed && value ? [value] : [],
      ),
    );
    if (account) addresses.add(account.email);
    for (const value of addresses) {
      const decision = await this.deps.router.route({ identifier: value, breakGlass: false });
      if (decision.outcome === "redirect_to_connection" && decision.connectionId !== undefined) {
        return true;
      }
    }
    return false;
  }
}
