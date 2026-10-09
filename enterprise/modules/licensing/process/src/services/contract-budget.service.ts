/**
 * The contract budget of a connected customer (ADR-156 §5): licensing answers the terms and, until
 * billing's renewal fact lands, starts a new window. The connect module syncs and caps the budget.
 */

import type { ContractTerms } from "@langwatch/enterprise-licensing-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { IssuedLicenseRecord } from "../repositories/issued-license.repository.ts";
import { contractTermsOf } from "../rules/contract-terms.rules.ts";

interface ContractBudgetCollaborators {
  store: ContractBudgetStore;
  licensesOf: (organizationId: string) => Promise<IssuedLicenseRecord[]>;
  now?: () => Instant;
}

export class ContractBudgetService {
  static create(collaborators: ContractBudgetCollaborators): ContractBudgetService {
    return new ContractBudgetService(collaborators);
  }

  readonly #now: () => Instant;

  private constructor(private readonly collaborators: ContractBudgetCollaborators) {
    this.#now = collaborators.now ?? nowInstant;
  }

  async termsOf(organizationId: string): Promise<ContractTerms> {
    return contractTermsOf({
      licenses: await this.collaborators.licensesOf(organizationId),
      now: this.#now(),
    });
  }

  /**
   * Starts a new budget window, so a renewal's prepaid credit is spent against
   * a cap that counts nothing from the term before it. No budget is a no-op:
   * the sync that follows a renewal creates one at the new commit.
   */
  async reset({
    organizationId,
    operatorId,
  }: {
    organizationId: string;
    operatorId: string;
  }): Promise<void> {
    const existing = await this.collaborators.store.findForOrganization(organizationId);
    if (!existing) return;
    await this.collaborators.store.reset({
      organizationId,
      id: existing.id,
      actorId: operatorId,
    });
  }
}

/**
 * Says that the customer's commercial terms may have moved. Composition records the
 * contract_terms_changed fact; connect syncs the budget from it.
 */
export interface ContractBudgets {
  sync(params: { organizationId: string; operatorId: string }): Promise<void>;
}

/** The one blocking organization budget hosted usage stops at. */
export interface ContractBudget {
  id: string;
  limitUsdCents: number;
  /** Whether the customer chose this cap, as opposed to it following the commit. */
  capSetByCustomer: boolean;
}

/**
 * Where the contract budget is kept, which is the gateway's own budget table.
 * Declared here and answered by composition: licensing states what it needs of
 * a budget and never queries a table another feature owns. S3 retires it.
 */
export interface ContractBudgetStore {
  findForOrganization(organizationId: string): Promise<ContractBudget | null>;
  /** Starts a new window: spend so far no longer counts against the cap. */
  reset(params: { organizationId: string; id: string; actorId: string }): Promise<void>;
}
