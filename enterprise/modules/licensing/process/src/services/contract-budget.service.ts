/**
 * The contract terms of a connected customer (ADR-156 §5): licensing answers them; the connect
 * module syncs, caps and resets the budget from licensing's and billing's facts (C3a).
 */

import type { ContractTerms } from "@langwatch/enterprise-licensing-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { IssuedLicenseRecord } from "../repositories/issued-license.repository.ts";
import { contractTermsOf } from "../rules/contract-terms.rules.ts";

interface ContractBudgetCollaborators {
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
}

/**
 * Says that the customer's commercial terms may have moved. Composition records the
 * contract_terms_changed fact; connect syncs the budget from it.
 */
export interface ContractBudgets {
  sync(params: { organizationId: string; operatorId: string }): Promise<void>;
}
