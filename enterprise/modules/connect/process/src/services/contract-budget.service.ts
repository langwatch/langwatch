/**
 * The contract budget of a connected customer (ADR-156 §5): one blocking organization budget that
 * follows the terms and that the customer may lower to the commit plus the agreed overage maximum.
 * The terms are licensing's; the budget is the gateway's.
 */

import {
  ConnectBudgetAboveContractMaximumError,
  ConnectBudgetNotSetError,
  type LicensingApi,
} from "@langwatch/enterprise-licensing-contract";
import { ValidationError } from "@langwatch/handled-error";

const CENTS = 100;

interface ContractBudgetCollaborators {
  store: ContractBudgetStore;
  terms: Pick<LicensingApi, "getContractTerms">;
  /** Attributed when the customer moves its own cap: no person is present. */
  systemActorId: string;
}

export class ContractBudgetService {
  static create(collaborators: ContractBudgetCollaborators): ContractBudgetService {
    return new ContractBudgetService(collaborators);
  }

  private constructor(private readonly collaborators: ContractBudgetCollaborators) {}

  /** Brings the budget in line with the customer's current terms; safe to repeat. */
  async sync({
    organizationId,
    operatorId,
  }: {
    organizationId: string;
    operatorId: string;
  }): Promise<void> {
    const terms = await this.collaborators.terms.getContractTerms({ organizationId });
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

    const { maximumUsdCents } = await this.collaborators.terms.getContractTerms({
      organizationId,
    });
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

/** The one blocking organization budget hosted usage stops at. */
export interface ContractBudget {
  id: string;
  limitUsdCents: number;
  /** Whether the customer chose this cap, as opposed to it following the commit. */
  capSetByCustomer: boolean;
}

/** Where the contract budget is kept: the gateway's own budget table, reached through its Api. */
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
}
