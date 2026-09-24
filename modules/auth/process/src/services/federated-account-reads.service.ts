import { configuredSsoProviderStatus, extractEmailDomain } from "@langwatch/auth-contract";

import type { BetterAuthHooksRepository } from "../repositories/better-auth-hooks.repository.ts";

export interface FederatedAccountReadsServiceDeps {
  accounts: BetterAuthHooksRepository;
}

/**
 * Which identity providers a person holds an account through. Auth owns every
 * `Account` row, so a peer deciding something about that person asks rather
 * than reading them (ADR-129).
 */
export class FederatedAccountReadsService {
  static create(deps: FederatedAccountReadsServiceDeps): FederatedAccountReadsService {
    return new FederatedAccountReadsService(deps);
  }

  private constructor(private readonly deps: FederatedAccountReadsServiceDeps) {}

  /** Each provider once: two accounts through one provider is still one way
   *  in, and the callers ask about the provider, not the row. */
  async findProvidersForUser({ userId }: { userId: string }): Promise<string[]> {
    const accounts = await this.deps.accounts.findFederatedAccountsForUser({ userId });

    return [...new Set(accounts.map((account) => account.providerId))];
  }

  /** The sign-in hook's own question, re-asked of every account held: an
   *  address with no domain still owes it, a domain nobody pins owes nothing. */
  async getSsoSetupStatus({
    userId,
    email,
  }: {
    userId: string;
    email: string;
  }): Promise<{ pendingSsoSetup: boolean }> {
    const domain = extractEmailDomain(email);
    if (!domain) return { pendingSsoSetup: true };

    const accounts = await this.deps.accounts.findFederatedAccountsForUser({ userId });
    const status = await configuredSsoProviderStatus({
      organizations: {
        findByDomain: (args) => this.deps.accounts.tryFindOrganizationBySsoDomain(args),
      },
      domain,
      accounts,
    });

    return { pendingSsoSetup: status === "unmatched" };
  }
}
