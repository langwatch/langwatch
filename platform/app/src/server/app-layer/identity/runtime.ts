/**
 * The identity runtime: THE composition root (ADR-115 §4). The one place
 * Prisma, the better-auth row engine, the migration-state table and the
 * event-sourcing pipeline handle meet `@langwatch/identity-server`'s
 * services. Nothing else constructs an IdentityService, a guard, or a
 * ceremony; a consumer imports the composed instance from here or is wrong.
 *
 * Only server-only modules may import this file: its graph reaches
 * `~/server/db` at module scope. Every environment read the services need
 * is a closure passed from here — the packages read no env of their own.
 */
import {
  IdentityBackfillService,
  IdentityGuards,
  IdentityService,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import { createIdentityDatabase } from "@langwatch/identity-server/better-auth";
import type { BetterAuthOptions, DBAdapter } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../../db";
import { PrismaSystemMigrationStateRepository } from "../system-migrations/repositories/system-migration-state.prisma.repository";
import { IdentityIdentifierBackfillMigration } from "./identifier-backfill.migration";
import { IdentityLedgerWriter } from "./ledger";
import { PrismaIdentityBackfillRepository } from "./repositories/identity-backfill.prisma.repository";
import { PrismaIdentityHeadsRepository } from "./repositories/identity-heads.prisma.repository";
import { PrismaIdentityProjectionRepository } from "./repositories/identity-projection.prisma.repository";
import { PrismaIdentityUsersRepository } from "./repositories/identity-users.prisma.repository";
import { PrismaIdentityVerificationRepository } from "./repositories/identity-verification.prisma.repository";
import { isUserOnIdentityWrites } from "./write-gate";

const identityHeads = new PrismaIdentityHeadsRepository(prisma);
const identityUsers = new PrismaIdentityUsersRepository(prisma);
const migrationState = new PrismaSystemMigrationStateRepository(prisma);

/** The per-user write gate as the services take it: one closure, one
 *  state repository, composed here rather than defaulted inside a service. */
export function isLatched({ userId }: { userId: string }): Promise<boolean> {
  return isUserOnIdentityWrites({ userId, state: migrationState });
}

/**
 * The write surface. Composed per call like `grantsService()`: the ledger
 * writer resolves the pipeline handle lazily, so a ceremony composed before
 * the App exists (better-auth builds its adapter at module load) still
 * appends once one does.
 */
export function identityService(): IdentityService {
  return new IdentityService(
    new IdentityGuards(identityHeads),
    new IdentityLedgerWriter({
      projectionStore: new PrismaIdentityProjectionRepository(prisma),
    }),
  );
}

export function verificationCeremony(): VerificationCeremonyService {
  return new VerificationCeremonyService(
    new PrismaIdentityVerificationRepository(prisma),
    identityHeads,
    identityService(),
    { isLatched },
  );
}

export function identityBackfill(): IdentityBackfillService {
  return new IdentityBackfillService(
    new PrismaIdentityBackfillRepository(prisma),
    identityUsers,
    identityService(),
  );
}

/** The D01 backfill as the migrations runtime registers it (tenant = user). */
export function identifierBackfillMigration(): IdentityIdentifierBackfillMigration {
  return new IdentityIdentifierBackfillMigration(identityBackfill());
}

/**
 * better-auth's `database`: the routing facade over the stock prismaAdapter
 * (ADR-101 §2). Protocol behavior is byte-identical to the stock adapter;
 * domain-significant writes additionally run identity ceremonies for users
 * whose backfill has latched. The gate ships closed, so deploying this
 * changes nothing on its own.
 */
export function identityDatabase(): (options: BetterAuthOptions) => DBAdapter {
  return createIdentityDatabase({
    base: prismaAdapter(prisma, { provider: "postgresql" }),
    heads: identityHeads,
    users: identityUsers,
    identity: identityService(),
    isLatched,
  });
}
