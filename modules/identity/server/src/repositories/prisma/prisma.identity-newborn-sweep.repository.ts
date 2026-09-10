import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { IdentityLedgerWriterAdapter } from "../../services/identity-ledger.service.ts";
import { PostgresIdentityGuardsAdapter } from "../../repositories/prisma/prisma.identity-guards.repository.ts";
import type { IdentityEventingPort } from "../../app/identity.infrastructure.ts";
import { PrismaIdentityNewbornRepository } from "./prisma.identity-newborn.repository.ts";
import { PrismaIdentityProjectionRepository } from "./prisma.identity-projection.repository.ts";
import { IdentityNewbornReconciliationService } from "../../services/identity-newborn-reconciliation.service.ts";
import { IdentityService } from "../../services/identity.service.ts";

export type PostgresIdentityNewbornSweepOptions = {
  database: PrismaClient;
  /** The event stack the erase command stages through. */
  eventing: IdentityEventingPort;
};

/**
 * The abandoned-newborn sweep (ADR-116 §3) over Postgres: the claims table,
 * the address lock the guards claim through, and the erase command a real
 * deletion uses. Composed wherever the migration pass runs, as a leg of it.
 */
export class PostgresIdentityNewbornSweepAdapter {
  static create(options: PostgresIdentityNewbornSweepOptions): PostgresIdentityNewbornSweepAdapter {
    return new PostgresIdentityNewbornSweepAdapter(options);
  }

  private constructor(private readonly options: PostgresIdentityNewbornSweepOptions) {}

  build(): IdentityNewbornReconciliationService {
    const { database, eventing } = this.options;
    // The SAME address lock the guards claim through (ADR-116 §6): a second
    // lock instance would release something this process never claimed.
    const guards = PostgresIdentityGuardsAdapter.create({ database }).build();
    return IdentityNewbornReconciliationService.create({
      newborns: PrismaIdentityNewbornRepository.create(database),
      identity: IdentityService.create(
        guards.identityGuards,
        IdentityLedgerWriterAdapter.create({
          projectionStore: PrismaIdentityProjectionRepository.create({
            prisma: database,
            reservations: guards.reservations,
          }),
          eventing,
        }),
      ),
      reservations: guards.reservations,
    });
  }
}
