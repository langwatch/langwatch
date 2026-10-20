import type { TenantMigrationRolledBackEventData } from "@langwatch/ops-contract";
import { Temporal } from "@langwatch/time";

/** The rollback fact's command sender, as ops' own pipeline answers with it once registered. */
export type TenantMigrationRolledBackSender = {
  send(
    input: TenantMigrationRolledBackEventData & { tenantId: string; occurredAt: number },
  ): Promise<unknown>;
};

/**
 * Records an operator's rollback as ops' fact, so the step's owner turns its own switch off
 * (Alex, 2026-10-12; ADR-179). Refuses when it cannot record: the pin stands, and the operator
 * sees a rollback recorded but not applied and retries it, as for any rollback effect.
 */
export class SystemMigrationRollbackFactsService {
  static create(): SystemMigrationRollbackFactsService {
    return new SystemMigrationRollbackFactsService();
  }

  private constructor() {}

  #sender: TenantMigrationRolledBackSender | null = null;

  connect(sender: TenantMigrationRolledBackSender): void {
    this.#sender = sender;
  }

  async record({
    migrationName,
    tenantId,
    actorUserId,
    decidedAt,
  }: {
    migrationName: string;
    tenantId: string;
    actorUserId: string;
    decidedAt: string;
  }): Promise<void> {
    if (!this.#sender) {
      throw new Error(
        "this process never connected the rollback fact's command, so the step's owner cannot be told",
      );
    }
    await this.#sender.send({
      tenantId,
      rolledBackTenantId: tenantId,
      stepId: migrationName,
      actorUserId,
      occurredAt: Temporal.Instant.from(decidedAt).epochMilliseconds,
    });
  }
}
