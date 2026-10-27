/**
 * The spend catch-up step's backfill: each organization's confirmed Instant Evals ledger spend
 * copied into the judge's own spend, a page of organizations at a time (ADR-174 decision 17).
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { ORGANIZATION_ID_PAGE_LIMIT, type OrganizationApi } from "@langwatch/organization-contract";

import type { InstantEvalJudgeSpendCatchUp } from "./instant-eval-judge-spend-catch-up.service.ts";

type InstantEvalJudgeSpendBackfillPeers = Readonly<{
  organizations: Pick<OrganizationApi, "listAllIds">;
  /** Copies one organization's ledger spend; a dry run only reads it. */
  copy: (input: {
    organizationId: string;
    signal: AbortSignal;
    isDryRun: boolean;
  }) => Promise<InstantEvalJudgeSpendCatchUp>;
}>;

type Totals = {
  organizations: number;
  ledgerRows: number;
  ledgerNanoUsd: number;
  copied: number;
  alreadyHeld: number;
};

export class InstantEvalJudgeSpendBackfillService {
  private constructor(private readonly peers: InstantEvalJudgeSpendBackfillPeers) {}

  static create({
    peers,
  }: {
    peers: InstantEvalJudgeSpendBackfillPeers;
  }): InstantEvalJudgeSpendBackfillService {
    return new InstantEvalJudgeSpendBackfillService(peers);
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
    const totals: Totals = {
      organizations: 0,
      ledgerRows: 0,
      ledgerNanoUsd: 0,
      copied: 0,
      alreadyHeld: 0,
    };
    let cursor = after;
    let hasMore = true;
    while (hasMore && !signal.aborted) {
      const page = await this.peers.organizations.listAllIds({
        after: cursor,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      const completed = await this.copyPage({ ids: page.ids, dryRun, signal, totals });
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
  private async copyPage({
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
      const caughtUp = await this.peers.copy({ organizationId, signal, isDryRun: dryRun });
      totals.organizations += 1;
      totals.ledgerRows += caughtUp.ledgerRows;
      totals.ledgerNanoUsd += caughtUp.ledgerNanoUsd;
      totals.copied += caughtUp.copied;
      totals.alreadyHeld += caughtUp.alreadyHeld;
    }
    return true;
  }
}
