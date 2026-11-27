// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The customer-io-plan-resync task's walk: each organization's plan and active members recorded
 * again as a catch-up fact, a page of organizations at a time; nurturing sends each to Customer.io.
 * Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import { BillingOrganizationWalkService } from "./billing-organization-walk.service.ts";

/** What a resync reads and records through. */
export type CustomerIoPlanResyncPeers = Readonly<{
  /** Organization ids through organization's shared table (C2 B). */
  organizations: Pick<BillingAccountFactsRepository, "listIds">;
  /** Records one organization's catch-up fact; a dry run only reads its members. */
  catchUp: (input: { organizationId: string; isDryRun: boolean }) => Promise<{ members: number }>;
}>;

/** What a run counts. Facts recorded, not calls delivered: delivery is nurturing's, and retries. */
export type CustomerIoPlanResyncTotals = {
  organizations: number;
  members: number;
  factsRecorded: number;
  /** Upper bound: nurturing may skip members and unchanged organizations. */
  maxGroupCalls: number;
  /** Upper bound: nurturing may skip members and unchanged organizations. */
  maxIdentifies: number;
  skipped: { no_active_members: number };
};

export class CustomerIoPlanResyncService {
  private readonly pages: BillingOrganizationWalkService;

  private constructor(private readonly peers: CustomerIoPlanResyncPeers) {
    this.pages = BillingOrganizationWalkService.create({ peers });
  }

  static create({ peers }: { peers: CustomerIoPlanResyncPeers }): CustomerIoPlanResyncService {
    return new CustomerIoPlanResyncService(peers);
  }

  /**
   * Each organization from the start, a page at a time; `onPage` hears the last organization of
   * each completed page, never on a dry run. Stops between organizations on abort.
   */
  async resync({
    dryRun,
    signal,
    onPage,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (page: { afterOrganizationId: string }) => Promise<void>;
  }): Promise<CustomerIoPlanResyncTotals & { afterOrganizationId: string | null }> {
    const totals: CustomerIoPlanResyncTotals = {
      organizations: 0,
      members: 0,
      factsRecorded: 0,
      maxGroupCalls: 0,
      maxIdentifies: 0,
      skipped: { no_active_members: 0 },
    };
    const { afterOrganizationId } = await this.pages.walk({
      after: undefined,
      dryRun,
      signal,
      onPage,
      step: async (organizationId) => {
        const { members } = await this.peers.catchUp({ organizationId, isDryRun: dryRun });
        totals.organizations += 1;
        if (members === 0) {
          totals.skipped.no_active_members += 1;
          return;
        }
        totals.members += members;
        totals.maxGroupCalls += 1;
        totals.maxIdentifies += members;
        if (!dryRun) totals.factsRecorded += 1;
      },
    });
    return { afterOrganizationId, ...totals };
  }
}
