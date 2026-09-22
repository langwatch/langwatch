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
}
