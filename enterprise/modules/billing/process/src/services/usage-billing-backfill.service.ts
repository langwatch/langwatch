// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The usage-billing catch-up step's backfill: whether the meter bills each organization, recorded
 * a page of organizations at a time (ADR-174 decision 17).
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";

import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";

type UsageBillingBackfillPeers = Readonly<{
  /** Organization ids through organization's shared table (C2 B). */
  organizations: Pick<BillingAccountFactsRepository, "listIds">;
  /** Records one organization's usage-billed fact; a dry run only reads it. */
  catchUp: (input: {
    organizationId: string;
    isDryRun: boolean;
  }) => Promise<{ usageBilled: boolean }>;
}>;

type Totals = { organizations: number; usageBilled: number };

export class UsageBillingBackfillService {
  private constructor(private readonly peers: UsageBillingBackfillPeers) {}

  static create({ peers }: { peers: UsageBillingBackfillPeers }): UsageBillingBackfillService {
    return new UsageBillingBackfillService(peers);
  }

  /**
   * Each organization after `after`, a page at a time; `onPage` hears the last organization of
   * each completed page, never on a dry run. Stops between organizations on abort.
   */
  async backfill({
    after,
    dryRun,
    signal,
    onPage,
  }: {
    after: string | undefined;
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (page: { afterOrganizationId: string }) => Promise<void>;
  }): Promise<Totals & { afterOrganizationId: string | null }> {
    const totals: Totals = { organizations: 0, usageBilled: 0 };
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
    totals: Totals;
  }): Promise<boolean> {
    for (const organizationId of ids) {
      if (signal.aborted) return false;
      const { usageBilled } = await this.peers.catchUp({ organizationId, isDryRun: dryRun });
      totals.organizations += 1;
      if (usageBilled) totals.usageBilled += 1;
    }
    return true;
  }
}
