// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * billing:resync-customer-io-plan: each organization's plan and active members recorded again as
 * a catch-up fact, a page of organizations at a time; nurturing sends each to Customer.io.
 * Spec: enterprise/modules/nurturing/specs/customer-io-plan-traits.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";

import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";

type CustomerIoPlanResyncPeers = Readonly<{
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
  plannedGroupCalls: number;
  plannedIdentifies: number;
  skipped: { no_active_members: number };
};

export class CustomerIoPlanResyncService {
  private constructor(private readonly peers: CustomerIoPlanResyncPeers) {}

  static create({ peers }: { peers: CustomerIoPlanResyncPeers }): CustomerIoPlanResyncService {
    return new CustomerIoPlanResyncService(peers);
  }

  /**
   * Each organization after `after`, a page at a time; `onPage` hears the last organization of
   * each completed page, never on a dry run. Stops between organizations on abort.
   */
  async resync({
    after,
    dryRun,
    signal,
    onPage,
  }: {
    after: string | undefined;
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (page: { afterOrganizationId: string }) => Promise<void>;
  }): Promise<CustomerIoPlanResyncTotals & { afterOrganizationId: string | null }> {
    const totals: CustomerIoPlanResyncTotals = {
      organizations: 0,
      members: 0,
      factsRecorded: 0,
      plannedGroupCalls: 0,
      plannedIdentifies: 0,
      skipped: { no_active_members: 0 },
    };
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal.aborted) {
      const page = await this.peers.organizations.listIds({
        after: cursor,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      const completed = await this.recordPage({ ids: page.ids, dryRun, signal, totals });
      const last = page.ids.at(-1);
      if (completed && last !== undefined) {
        cursor = last;
        if (!dryRun) await onPage({ afterOrganizationId: last });
      }
      hasMore = completed && page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null, ...totals };
  }

  /** One page's organizations; false when the signal stopped it part way. */
  private async recordPage({
    ids,
    dryRun,
    signal,
    totals,
  }: {
    ids: readonly string[];
    dryRun: boolean;
    signal: AbortSignal;
    totals: CustomerIoPlanResyncTotals;
  }): Promise<boolean> {
    for (const organizationId of ids) {
      if (signal.aborted) return false;
      const { members } = await this.peers.catchUp({ organizationId, isDryRun: dryRun });
      totals.organizations += 1;
      if (members === 0) {
        totals.skipped.no_active_members += 1;
        continue;
      }
      totals.members += members;
      totals.plannedGroupCalls += 1;
      totals.plannedIdentifies += members;
      if (!dryRun) totals.factsRecorded += 1;
    }
    return true;
  }
}
