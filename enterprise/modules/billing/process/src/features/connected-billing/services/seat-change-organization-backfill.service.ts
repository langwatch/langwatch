// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The background step that names the organization on seat changes recorded before the column
 * existed, from their billing account, a batch at a time (20261006170522).
 * Spec: specs/self-hosting/connected-services/connected-billing.feature
 */
import type { ConnectedBillingRepository } from "../../../repositories/connected-billing.repository.ts";

const BATCH = 500;

export class SeatChangeOrganizationBackfillService {
  private constructor(
    private readonly repository: Pick<ConnectedBillingRepository, "fillSeatChangeOrganizations">,
  ) {}

  static create({
    repository,
  }: {
    repository: Pick<ConnectedBillingRepository, "fillSeatChangeOrganizations">;
  }): SeatChangeOrganizationBackfillService {
    return new SeatChangeOrganizationBackfillService(repository);
  }

  /**
   * Every seat change after `after` that names no organization; `onBatch` hears the last license
   * row of each batch, never on a dry run. Stops between batches on abort.
   */
  async backfill({
    after,
    dryRun,
    signal,
    onBatch,
  }: {
    after: string | null;
    dryRun: boolean;
    signal: AbortSignal;
    onBatch: (batch: { afterLicenseRowId: string; filled: number }) => Promise<void>;
  }): Promise<{ filled: number; afterLicenseRowId: string | null }> {
    let cursor = after;
    let filled = 0;
    while (!signal.aborted) {
      const batch = await this.repository.fillSeatChangeOrganizations({
        after: cursor,
        limit: BATCH,
        dryRun,
      });
      filled += batch.filled;
      if (batch.lastLicenseRowId === null) break;
      cursor = batch.lastLicenseRowId;
      if (!dryRun) await onBatch({ afterLicenseRowId: cursor, filled });
    }
    return { filled, afterLicenseRowId: cursor };
  }
}
