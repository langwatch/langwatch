import type { IdentityLatchRepository } from "../repositories/identity-latch.repository.ts";
import type { SsoArrivalIdentityAdoption } from "../rules/sso-arrival-contract.rules.ts";
import type { IdentityBackfillService } from "./identity-backfill.service.ts";

/**
 * Adopting the one person an arrival just admitted, rather than waiting for a fleet-wide
 * pass: the runner's per-user backfill, idempotent on a retry. A finalized outcome is
 * recorded as D01's state for that user (Alex, 2026-10-06).
 */
export class SsoArrivalAdoptionService implements SsoArrivalIdentityAdoption {
  static create({
    backfill,
    latch,
  }: {
    backfill: Pick<IdentityBackfillService, "migrateUser">;
    latch: Pick<IdentityLatchRepository, "recordFinalized">;
  }): SsoArrivalAdoptionService {
    return new SsoArrivalAdoptionService(backfill, latch);
  }

  private constructor(
    private readonly backfill: Pick<IdentityBackfillService, "migrateUser">,
    private readonly latch: Pick<IdentityLatchRepository, "recordFinalized">,
  ) {}

  async adopt({ userId }: { userId: string }): Promise<void> {
    const outcome = await this.backfill.migrateUser({ userId });
    if (outcome.status !== "finalized") return;
    await this.latch.recordFinalized({ userId, report: outcome.report });
  }
}
