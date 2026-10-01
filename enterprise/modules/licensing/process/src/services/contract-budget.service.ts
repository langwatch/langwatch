/**
 * The contract budget of a connected customer (ADR-156 §5): one blocking
 * organization budget, moved by LangWatch when the terms change and by the
 * customer up to the commit plus the agreed overage maximum.
 */

import {
  ConnectBudgetAboveContractMaximumError,
  ConnectBudgetNotSetError,
  type ContractTerms,
} from "@langwatch/enterprise-licensing-contract";
import { ValidationError } from "@langwatch/handled-error";
import { nowInstant, type Instant } from "@langwatch/time";

import type { ContractBudgets, ContractBudgetStore } from "../app/licensing.members.ts";
import type { IssuedLicenseRecord } from "../repositories/issued-license.repository.ts";
import { contractTermsOf } from "../rules/contract-terms.rules.ts";

const CENTS = 100;

export interface ContractBudgetCollaborators {
  store: ContractBudgetStore;
  licensesOf: (organizationId: string) => Promise<IssuedLicenseRecord[]>;
  /** Attributed when the customer moves its own cap: no person is present. */
  systemActorId: string;
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

  /** The customer sets its own cap. It may be below what is already spent. */
  async setCap({
    organizationId,
    capUsdCents,
  }: {
    organizationId: string;
    capUsdCents: number;
  }): Promise<{ capUsdCents: number; maximumUsdCents: number }> {
    if (!Number.isSafeInteger(capUsdCents) || capUsdCents <= 0) {
      throw new ValidationError("The cap must be a positive amount");
    }
    const existing = await this.collaborators.store.findForOrganization(organizationId);
    if (!existing) throw new ConnectBudgetNotSetError();

    const { maximumUsdCents } = await this.termsOf(organizationId);
    if (capUsdCents > maximumUsdCents) {
      throw new ConnectBudgetAboveContractMaximumError(maximumUsdCents / CENTS);
    }
    await this.collaborators.store.setLimit({
      organizationId,
      id: existing.id,
      limitUsdCents: capUsdCents,
      capSetByCustomer: true,
      actorId: this.collaborators.systemActorId,
    });
    return { capUsdCents, maximumUsdCents };
  }
}
