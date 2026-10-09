/**
 * The contract budget of a connected customer (ADR-156 §5): one blocking
 * organization budget, moved by LangWatch when the terms change. The customer
 * moves its own cap through the connect module.
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

export class ContractBudgetService implements ContractBudgets {
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

  /** Brings the budget in line with the customer's current terms. */
  async sync({
    organizationId,
    operatorId,
  }: {
    organizationId: string;
    operatorId: string;
  }): Promise<void> {
    const terms = await this.termsOf(organizationId);
    // Nothing agreed, or nothing left: a budget is not created for it, and one
    // that exists keeps its cap. Access is already closed by the credential.
    if (terms.maximumUsdCents === 0) return;

    const existing = await this.collaborators.store.findForOrganization(organizationId);
    const followsTerms = terms.commitUsdCents > 0 ? terms.commitUsdCents : terms.maximumUsdCents;
    if (!existing) {
      await this.collaborators.store.create({
        organizationId,
        limitUsdCents: followsTerms,
        operatorId,
      });
      return;
    }

    const target = existing.capSetByCustomer
      ? Math.min(existing.limitUsdCents, terms.maximumUsdCents)
      : followsTerms;
    if (target === existing.limitUsdCents) return;
    await this.collaborators.store.setLimit({
      organizationId,
      id: existing.id,
      limitUsdCents: target,
      capSetByCustomer: existing.capSetByCustomer,
      actorId: operatorId,
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
 * The customer's contract budget, which follows the commercial terms of its
 * licenses. Called after any change that can move those terms. The module owns
 * the behaviour; composition supplies only the store below.
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
 * a budget and never queries a table another feature owns.
 */
export interface ContractBudgetStore {
  findForOrganization(organizationId: string): Promise<ContractBudget | null>;
  create(params: {
    organizationId: string;
    limitUsdCents: number;
    operatorId: string;
  }): Promise<void>;
  setLimit(params: {
    organizationId: string;
    id: string;
    limitUsdCents: number;
    capSetByCustomer: boolean;
    actorId: string;
  }): Promise<void>;
  /** Starts a new window: spend so far no longer counts against the cap. */
  reset(params: { organizationId: string; id: string; actorId: string }): Promise<void>;
}
