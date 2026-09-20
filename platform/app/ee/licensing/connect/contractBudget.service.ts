/**
 * The contract budget of a connected customer (ADR-139): one blocking
 * organization budget that starts equal to the prepaid commit and is the hard
 * stop for hosted usage.
 *
 * Two hands move it. LangWatch moves it when the commercial terms change, and
 * the customer may set its own cap anywhere up to the commit plus the agreed
 * overage maximum. A cap the customer chose is kept when the terms change,
 * and only lowered when it would exceed the new maximum.
 */

import { ValidationError } from "@langwatch/handled-error";
import type {
  ContractBudgetSyncPort,
  IssuedLicenseRecord,
} from "../registry/issuedLicense";
import { type ContractTerms, contractTermsOf } from "./contractTerms";
import {
  ConnectBudgetAboveContractMaximumError,
  ConnectBudgetNotSetError,
} from "./errors";

export interface ContractBudget {
  id: string;
  limitUsdCents: number;
  /** Whether the customer chose this cap, as opposed to it following the commit. */
  capSetByCustomer: boolean;
}

export interface ContractBudgetStore {
  find(organizationId: string): Promise<ContractBudget | null>;
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

export interface ContractBudgetDependencies {
  store: ContractBudgetStore;
  licensesOf: (organizationId: string) => Promise<IssuedLicenseRecord[]>;
  /** Attributed when the customer moves its own cap: no person is present. */
  systemActorId: string;
  now?: () => Date;
}

export class ContractBudgetService implements ContractBudgetSyncPort {
  private readonly now: () => Date;

  constructor(private readonly deps: ContractBudgetDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async termsOf(organizationId: string): Promise<ContractTerms> {
    return contractTermsOf({
      licenses: await this.deps.licensesOf(organizationId),
      now: this.now(),
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

    const existing = await this.deps.store.find(organizationId);
    const followsTerms =
      terms.commitUsdCents > 0 ? terms.commitUsdCents : terms.maximumUsdCents;
    if (!existing) {
      await this.deps.store.create({
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
    await this.deps.store.setLimit({
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
    const existing = await this.deps.store.find(organizationId);
    if (!existing) throw new ConnectBudgetNotSetError();

    const { maximumUsdCents } = await this.termsOf(organizationId);
    if (capUsdCents > maximumUsdCents) {
      throw new ConnectBudgetAboveContractMaximumError(maximumUsdCents / 100);
    }
    await this.deps.store.setLimit({
      organizationId,
      id: existing.id,
      limitUsdCents: capUsdCents,
      capSetByCustomer: true,
      actorId: this.deps.systemActorId,
    });
    return { capUsdCents, maximumUsdCents };
  }
}
