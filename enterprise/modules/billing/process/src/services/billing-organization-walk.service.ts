// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The organization walk billing's catch-up runs share: every organization after a cursor, a page
 * at a time, each handed to the caller's step, with a checkpoint after each completed page.
 */
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";

import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";

type OrganizationWalkPeers = Readonly<{
  /** Organization ids through organization's shared table (C2 B). */
  organizations: Pick<BillingAccountFactsRepository, "listIds">;
}>;

export class BillingOrganizationWalkService {
  private constructor(private readonly peers: OrganizationWalkPeers) {}

  static create({ peers }: { peers: OrganizationWalkPeers }): BillingOrganizationWalkService {
    return new BillingOrganizationWalkService(peers);
  }

  /**
   * Each organization after `after` through `step`, a page at a time; `onPage` hears the last
   * organization of each completed page, never on a dry run. Stops between organizations on
   * abort, and returns the last organization of the last completed page.
   */
  async walk({
    after,
    dryRun,
    signal,
    onPage,
    step,
  }: {
    after: string | undefined;
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (page: { afterOrganizationId: string }) => Promise<void>;
    step: (organizationId: string) => Promise<void>;
  }): Promise<{ afterOrganizationId: string | null }> {
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal.aborted) {
      const page = await this.peers.organizations.listIds({
        after: cursor,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      const completed = await this.walkPage({ ids: page.ids, signal, step });
      const last = page.ids.at(-1);
      if (completed && last !== undefined) {
        cursor = last;
        if (!dryRun) await onPage({ afterOrganizationId: last });
      }
      hasMore = completed && page.next !== null;
    }
    return { afterOrganizationId: cursor ?? null };
  }

  /** One page's organizations; false when the signal stopped it part way. */
  private async walkPage({
    ids,
    signal,
    step,
  }: {
    ids: readonly string[];
    signal: AbortSignal;
    step: (organizationId: string) => Promise<void>;
  }): Promise<boolean> {
    for (const organizationId of ids) {
      if (signal.aborted) return false;
      await step(organizationId);
    }
    return true;
  }
}
