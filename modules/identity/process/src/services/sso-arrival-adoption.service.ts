import type { SsoArrivalIdentityAdoption } from "../rules/sso-arrival-contract.rules.ts";
import type { IdentityBackfillService } from "./identity-backfill.service.ts";

/**
 * Adopting the one person an arrival just admitted, rather than waiting for a
 * fleet-wide pass to reach them: the same per-user backfill the migration
 * registry runs, called for a single user id and idempotent on a retry.
 */
export class SsoArrivalAdoptionService implements SsoArrivalIdentityAdoption {
  static create(backfill: IdentityBackfillService): SsoArrivalAdoptionService {
    return new SsoArrivalAdoptionService(backfill);
  }

  private constructor(private readonly backfill: IdentityBackfillService) {}

  async adopt({ userId }: { userId: string }): Promise<void> {
    await this.backfill.migrateUser({ userId });
  }
}
