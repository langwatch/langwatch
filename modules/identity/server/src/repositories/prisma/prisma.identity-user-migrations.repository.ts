import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SystemMigration } from "@langwatch/system-migrations";
import { CryptoIdentifierIdentityAdapter } from "../../services/crypto-identifier-identity.service.ts";
import { IdentityLedgerWriterAdapter } from "../../services/identity-ledger.service.ts";
import { PostgresIdentityGuardsAdapter } from "../../repositories/prisma/prisma.identity-guards.repository.ts";
import { IdentityIdentifierBackfillMigrationAdapter } from "../../services/system-migration-identity-identifier-backfill.service.ts";
import { IdentitySecretHealMigrationAdapter } from "../../services/system-migration-identity-secret-heal.service.ts";
import type { IdentityEventing } from "../../app/identity.infrastructure.ts";
import { PrismaIdentityBackfillRepository } from "./prisma.identity-backfill.repository.ts";
import { PrismaIdentityProjectionRepository } from "./prisma.identity-projection.repository.ts";
import { PrismaIdentitySecretCarryRepository } from "./prisma.identity-secret-carry.repository.ts";
import { PrismaIdentityUsersRepository } from "./prisma.identity-users.repository.ts";
import { IdentityBackfillPlanService } from "../../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../../services/identity-backfill.service.ts";
import { IdentitySecretCarryService } from "../../services/identity-secret-carry.service.ts";
import { IdentityService } from "../../services/identity.service.ts";

export type PostgresIdentityUserMigrationsOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: PrismaClient;
  /** The event stack the adoption commands stage through. */
  eventing: IdentityEventing;
};

/**
 * The USER-rooted migration registry (ADR-101 §6), in main's order: the D01
 * identifier backfill, then the bridge mirror's reverse leg. The heal rides
 * BESIDE the backfill because the runner skips a finalized record (ADR-116 §4).
 */
export class PostgresIdentityUserMigrationsAdapter {
  static create(
    options: PostgresIdentityUserMigrationsOptions,
  ): PostgresIdentityUserMigrationsAdapter {
    return new PostgresIdentityUserMigrationsAdapter(options);
  }

  private constructor(private readonly options: PostgresIdentityUserMigrationsOptions) {}

  build(): readonly SystemMigration[] {
    const { database, eventing } = this.options;
    // The SAME address lock the guards claim through (ADR-116 §6): a second
    // lock instance would release something this process never claimed.
    const guards = PostgresIdentityGuardsAdapter.create({ database }).build();
    const secrets = IdentitySecretCarryService.create(
      PrismaIdentitySecretCarryRepository.create(database),
    );
    const backfill = IdentityBackfillService.create(
      PrismaIdentityBackfillRepository.create(database),
      PrismaIdentityUsersRepository.create(database),
      IdentityService.create(
        guards.identityGuards,
        IdentityLedgerWriterAdapter.create({
          projectionStore: PrismaIdentityProjectionRepository.create({
            prisma: database,
            reservations: guards.reservations,
          }),
          eventing,
        }),
      ),
      secrets,
      IdentityBackfillPlanService.create(CryptoIdentifierIdentityAdapter.create()),
    );

    return [
      IdentityIdentifierBackfillMigrationAdapter.create(backfill),
      IdentitySecretHealMigrationAdapter.create(secrets),
    ];
  }
}
