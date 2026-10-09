// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a connected customer's statement and admin console overview read from the
 * modules that own it (ADR-156 section 7): the customers from the organization
 * directory, the contract budget and seats from the license registry; spend
 * and projects through gateway's and project's shares (round 37 D5).
 */

import type { ConnectedSpendView } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
import type { Instant } from "@langwatch/time";

import type { BillingAccountFactsRepository } from "../../../repositories/billing-account-facts.repository.ts";
import type { BillingGatewaySpendRepository } from "../../../repositories/billing-gateway-spend.repository.ts";
import type { BillingProjectDirectoryRepository } from "../../../repositories/billing-project-directory.repository.ts";
import type {
  CommitDrawdown,
  ConnectedCustomer,
  ConnectedStatementSources,
  StatementSeats,
  StatementSpendLine,
} from "./connected-monthly-statement.service.ts";

const CENTS_PER_USD = 100;
const NANO_USD_PER_CENT = 1_000_000_000 / CENTS_PER_USD;

/**
 * The request type each hosted service records its spend under. A service with
 * no request type yet contributes nothing rather than a zero line.
 */
const SERVICE_REQUEST_TYPES: Readonly<Record<string, string>> = {
  instant_evals: INSTANT_EVAL_REQUEST_TYPE,
};

/** The peers the facts are read through, each only as wide as the reads. */
export type ConnectedCustomerPeers = Readonly<{
  licensing: Pick<LicensingApi, "getConnectedSeats" | "getHostedUsage" | "getContractTerms">;
  gateway: Pick<
    BillingGatewaySpendRepository,
    "isSpendSourceAvailable" | "sumSpendNanoUsdByRequestType"
  >;
  organizations: Pick<BillingAccountFactsRepository, "findSelfHostedCustomers">;
  projects: Pick<BillingProjectDirectoryRepository, "findProjectIds">;
}>;

const toCents = (usd: number): number => Math.round(usd * CENTS_PER_USD);

export class ConnectedCustomerFactsService implements ConnectedStatementSources {
  private constructor(private readonly peers: ConnectedCustomerPeers) {}

  static create(peers: ConnectedCustomerPeers): ConnectedCustomerFactsService {
    return new ConnectedCustomerFactsService(peers);
  }

  findConnectedCustomers(): Promise<ConnectedCustomer[]> {
    return this.peers.organizations.findSelfHostedCustomers();
  }

  /**
   * Summed across every project of the organization, the same set the usage
   * meter reports, so the statement adds up to the invoice. No ledger reads as
   * no lines: the month cannot be read, and zero would be wrong.
   */
  async findSpendByService({
    organizationId,
    from,
    until,
  }: {
    organizationId: string;
    from: Instant;
    until: Instant;
  }): Promise<StatementSpendLine[]> {
    if (!this.peers.gateway.isSpendSourceAvailable()) return [];
    const tenantIds = await this.findProjectIds(organizationId);
    if (tenantIds.length === 0) return [];

    const lines: StatementSpendLine[] = [];
    for (const [service, requestType] of Object.entries(SERVICE_REQUEST_TYPES)) {
      const nanoUsd = await this.peers.gateway.sumSpendNanoUsdByRequestType({
        tenantIds,
        requestType,
        fromMs: from.epochMilliseconds,
        toMs: until.epochMilliseconds,
      });
      lines.push({ service, usdCents: Math.round(nanoUsd / NANO_USD_PER_CENT) });
    }
    return lines;
  }

  async getCommitDrawdown(organizationId: string): Promise<CommitDrawdown> {
    const spend = await this.readContractSpend(organizationId);
    return spend.spentUsdCents === null
      ? { kind: "unavailable" }
      : { kind: "read", usdCents: spend.spentUsdCents };
  }

  async getSeats(organizationId: string): Promise<StatementSeats> {
    const seats = await this.peers.licensing.getConnectedSeats({ organizationId });
    return { licensed: seats.licensed, reported: seats.reported };
  }

  /**
   * The contract budget as the customer's own calls see it, read off the
   * managed key they run under. With no managed key no call has resolved one,
   * so the spend is unread rather than zero and the cap is what the terms set.
   */
  async readContractSpend(organizationId: string): Promise<ConnectedSpendView> {
    const { managedVirtualKeyId } = await this.peers.licensing.getConnectedSeats({
      organizationId,
    });
    if (managedVirtualKeyId) {
      const usage = await this.peers.licensing.getHostedUsage({
        caller: { virtualKeyId: managedVirtualKeyId, organizationId, projectId: null },
      });
      const contract = usage.budgets.find((budget) => budget.is_contract);
      if (contract) {
        return {
          spendAvailable: usage.spend_available,
          limitUsdCents: toCents(contract.cap_usd),
          spentUsdCents: contract.spent_usd === null ? null : toCents(contract.spent_usd),
        };
      }
    }

    const terms = await this.peers.licensing.getContractTerms({ organizationId });
    return {
      spendAvailable: false,
      limitUsdCents: terms.commitUsdCents > 0 ? terms.commitUsdCents : terms.maximumUsdCents,
      spentUsdCents: null,
    };
  }

  /** Every live project the organization holds, governance included. */
  findProjectIds(organizationId: string): Promise<string[]> {
    return this.peers.projects.findProjectIds({ organizationId });
  }
}
