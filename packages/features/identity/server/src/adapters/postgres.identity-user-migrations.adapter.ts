import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SystemMigration } from "@langwatch/system-migrations";
import { CryptoIdentifierIdentityAdapter } from "./crypto.identifier-identity.adapter";
import { IdentityLedgerWriterAdapter } from "./identity-ledger.adapter";
import { PostgresIdentityGuardsAdapter } from "./postgres.identity-guards.adapter";
import { IdentityIdentifierBackfillMigrationAdapter } from "./system-migration.identity-identifier-backfill.adapter";
import { IdentitySecretHealMigrationAdapter } from "./system-migration.identity-secret-heal.adapter";
import type { IdentityEventingPort } from "../ports/identity-eventing.port";
import { PrismaIdentityBackfillRepository } from "../repositories/prisma/prisma.identity-backfill.repository";
import { PrismaIdentityProjectionRepository } from "../repositories/prisma/prisma.identity-projection.repository";
import { PrismaIdentitySecretCarryRepository } from "../repositories/prisma/prisma.identity-secret-carry.repository";
import { PrismaIdentityUsersRepository } from "../repositories/prisma/prisma.identity-users.repository";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service";
import { IdentityBackfillService } from "../services/identity-backfill.service";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service";
import { IdentityService } from "../services/identity.service";

export type PostgresIdentityUserMigrationsOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: PrismaClient;
  /** The event stack the adoption commands stage through. */
  eventing: IdentityEventingPort;
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
