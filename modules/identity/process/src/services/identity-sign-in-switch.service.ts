import type { TenantMigrationRolledBackEventData } from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";

import type { IdentityLatchRepository } from "../repositories/identity-latch.repository.ts";
import { isIdentifierBackfillStep } from "../rules/identity-migration-names.rules.ts";

/**
 * Identity's own sign-in switch, kept from ops' rollback fact (Alex, 2026-10-12; ADR-179): an
 * operator's rollback of the identifier backfill pins the user off the identifier path for good.
 */
export class IdentitySignInSwitchService {
  static create(options: {
    latch: Pick<IdentityLatchRepository, "pinSignInSwitch">;
  }): IdentitySignInSwitchService {
    return new IdentitySignInSwitchService(options.latch);
  }

  private constructor(private readonly latch: Pick<IdentityLatchRepository, "pinSignInSwitch">) {}

  /** Idempotent: a redelivered or retried rollback pins the same user again. */
  async rolledBack({
    fact,
    eventId,
    occurredAt,
  }: {
    fact: TenantMigrationRolledBackEventData;
    eventId: string;
    occurredAt: number;
  }): Promise<void> {
    if (!isIdentifierBackfillStep(fact.stepId)) return;
    await this.latch.pinSignInSwitch({
      userId: fact.rolledBackTenantId,
      at: Temporal.Instant.fromEpochMilliseconds(occurredAt),
      eventId,
    });
  }
}
