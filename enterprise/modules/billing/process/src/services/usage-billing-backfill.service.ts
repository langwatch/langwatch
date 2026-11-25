// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The usage-billing catch-up step's backfill: whether the meter bills each organization, recorded
 * a page of organizations at a time (ADR-174 decision 17).
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import { BillingOrganizationWalkService } from "./billing-organization-walk.service.ts";

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
  private readonly pages: BillingOrganizationWalkService;

  private constructor(private readonly peers: UsageBillingBackfillPeers) {
    this.pages = BillingOrganizationWalkService.create({ peers });
  }

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
    const { afterOrganizationId } = await this.pages.walk({
      after,
      dryRun,
      signal,
      onPage,
      step: async (organizationId) => {
        const { usageBilled } = await this.peers.catchUp({ organizationId, isDryRun: dryRun });
        totals.organizations += 1;
        if (usageBilled) totals.usageBilled += 1;
      },
    });
    return { afterOrganizationId, ...totals };
  }
}
