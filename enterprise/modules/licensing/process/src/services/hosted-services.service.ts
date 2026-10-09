/**
 * Licensing's half of the hosted end of Connect (ADR-156 §5): which active license
 * a managed key runs under, and the hosted usage billing still reads through
 * licensing. The hosted routes themselves are the connect module's.
 */

import {
  entitledConnectServices,
  type ConnectService,
  type ContractTerms,
  type HostedBudgetWire,
  type HostedCaller,
  type HostedUsageAnswer,
} from "@langwatch/enterprise-licensing-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { IssuedLicenseRepository } from "../repositories/issued-license.repository.ts";
import { statusOfIssuedLicense } from "../rules/issued-license.rules.ts";
import type { ContractBudgetService } from "./contract-budget.service.ts";
import type { HostedBudgetUsage, HostedUsageReader } from "./hosted-usage-reader.service.ts";

const CENTS = 100;

interface HostedServicesCollaborators {
  licenses: Pick<IssuedLicenseRepository, "findByVirtualKeyId">;
  usage: HostedUsageReader;
  contractBudgets: Pick<ContractBudgetService, "termsOf">;
  now?: () => Instant;
}

export class HostedServicesService {
  static create(collaborators: HostedServicesCollaborators): HostedServicesService {
    return new HostedServicesService(collaborators);
  }

  readonly #now: () => Instant;

  private constructor(private readonly collaborators: HostedServicesCollaborators) {
    this.#now = collaborators.now ?? nowInstant;
  }

  /**
   * The active license of this organization that holds the key, with the services it
   * is entitled to; empty for a plain virtual key, another customer's license, or one
   * that is no longer active. State is read on every call, never cached.
   */
  async findManagedKeyLicense({
    virtualKeyId,
    organizationId,
  }: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<{ services: ConnectService[] }[]> {
    const license = await this.collaborators.licenses.findByVirtualKeyId(virtualKeyId);
    if (!license || license.organizationId !== organizationId) return [];
    if (statusOfIssuedLicense(license, this.#now()) !== "active") return [];
    return [{ services: entitledConnectServices(license.services) }];
  }

  async usage({ caller }: { caller: HostedCaller }): Promise<HostedUsageAnswer> {
    const [licenses, reading] = await Promise.all([
      this.findManagedKeyLicense(caller),
      this.collaborators.usage.read(caller),
    ]);
    const terms: ContractTerms | null =
      licenses.length > 0
        ? await this.collaborators.contractBudgets.termsOf(caller.organizationId)
        : null;
    const contract = reading.budgets.find((budget) => budget.isContract);

    return {
      services: terms?.services ?? [],
      spend_available: reading.spendAvailable,
      read_at: reading.readAt.toString(),
      contract:
        terms && contract
          ? {
              ...budgetWire(contract),
              commit_usd: terms.commitUsdCents / CENTS,
              maximum_cap_usd: terms.maximumUsdCents / CENTS,
              overage_enabled: terms.overageEnabled,
              term_ends_at: terms.termEndsAt,
            }
          : null,
      budgets: reading.budgets.map(budgetWire),
    };
  }
}

function budgetWire(budget: HostedBudgetUsage): HostedBudgetWire {
  return {
    id: budget.id,
    scope: budget.scope,
    window: budget.window,
    on_breach: budget.onBreach,
    cap_usd: budget.limitUsd,
    spent_usd: budget.spentUsd,
    remaining_usd: budget.spentUsd === null ? null : Math.max(0, budget.limitUsd - budget.spentUsd),
    period_started_at: budget.periodStartedAt.toString(),
    is_contract: budget.isContract,
  };
}
