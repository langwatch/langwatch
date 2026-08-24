/**
 * The identity runtime: THE composition root (ADR-115 §4). The one place
 * Prisma, the migration-state table and the event-sourcing pipeline handle
 * meet `@langwatch/identity-server`'s services. Nothing else constructs an
 * IdentityService, a guard, or a ceremony; a consumer imports the composed
 * instance from here or is wrong.
 *
 * Only server-only modules may import this file: its graph reaches
 * `~/server/db` at module scope. Every environment read the services need
 * is a closure passed from here — the packages read no env of their own.
 */
import {
  IdentityBackfillService,
  IdentityEmailService,
  IdentityGuards,
  IdentityService,
  newIdentityCommandId,
  VerificationCeremonyService,
} from "@langwatch/identity-server";
import {
  createIdentityStorageAdapter,
  IdentityCeremonies,
} from "@langwatch/identity-server/better-auth";
import type { BetterAuthOptions } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../../db";
import { PrismaSystemMigrationStateRepository } from "../system-migrations/repositories/system-migration-state.prisma.repository";
import { IdentityIdentifierBackfillMigration } from "./identifier-backfill.migration";
import { IdentityLedgerWriter } from "./ledger";
import { PrismaIdentityAccountsRepository } from "./repositories/identity-accounts.prisma.repository";
import { PrismaIdentityBackfillRepository } from "./repositories/identity-backfill.prisma.repository";
import { PrismaIdentityHeadsRepository } from "./repositories/identity-heads.prisma.repository";
import { PrismaIdentityProjectionRepository } from "./repositories/identity-projection.prisma.repository";
import { PrismaIdentityResolutionRepository } from "./repositories/identity-resolution.prisma.repository";
import { PrismaIdentityUsersRepository } from "./repositories/identity-users.prisma.repository";
import { PrismaIdentityVerificationRepository } from "./repositories/identity-verification.prisma.repository";
import { isUserOnIdentityWrites } from "./write-gate";

const identityHeads = new PrismaIdentityHeadsRepository(prisma);
const identityUsers = new PrismaIdentityUsersRepository(prisma);
const identityAccounts = new PrismaIdentityAccountsRepository(prisma);
const identityResolution = new PrismaIdentityResolutionRepository(prisma);
const migrationState = new PrismaSystemMigrationStateRepository(prisma);

/** The per-user fork as the services take it: one closure, one state
 *  repository, composed here rather than defaulted inside a service. The
 *  SAME predicate forks the ceremonies' writes and the email read — ADR-110's
 *  one switch, re-tenanted to users. */
export function isLatched({ userId }: { userId: string }): Promise<boolean> {
  return isUserOnIdentityWrites({ userId, state: migrationState });
}

/**
 * The read fork for `User.email`. A module-level singleton rather than a
 * per-call composition: it holds no request state, and the session boundary
 * resolves it on every authenticated request.
 */
const identityEmailService = new IdentityEmailService(identityHeads, isLatched);

export function identityEmail(): IdentityEmailService {
  return identityEmailService;
}

/**
 * The write surface. Composed per call like `grantsService()`: the ledger
 * writer resolves the pipeline handle lazily, so a ceremony composed before
 * the App exists (better-auth builds its options at module load) still
 * appends once one does.
 */
export function identityService(): IdentityService {
  return new IdentityService(
    new IdentityGuards(identityHeads, identityUsers),
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
 * What better-auth's own `databaseHooks` call (ADR-101 §2): three methods
 * bound to `account.create.before`, `account.delete.before` and
 * `user.delete.before` in `server/better-auth/index.ts`, every one of which
 * returns having done nothing for a user whose backfill has not finalized.
 * The gate ships closed, so wiring them changes nothing on its own.
 */
export function identityCeremonies(): IdentityCeremonies {
  return new IdentityCeremonies(
    identityHeads,
    identityUsers,
    identityService(),
    isLatched,
    { now: Date.now, newCommandId: newIdentityCommandId },
  );
}

/**
 * better-auth's whole `database:` entry (ADR-116 §1): the identity storage
 * adapter, composed here like every other identity collaborator.
 *
 * The legacy branch is better-auth's own published Prisma engine rather than
 * a re-implementation, so an unlatched user's storage traffic is
 * byte-for-byte what it has always been — and the gate ships closed, which
 * makes that every user until an operator enrolls one.
 *
 * Built once, at module load, because `betterAuth()` is: the ceremonies it
 * carries resolve the pipeline handle lazily, so an adapter composed before
 * the App exists still appends once one does.
 */
const identityStorage = createIdentityStorageAdapter({
  legacyEngine: prismaAdapter(prisma, { provider: "postgresql" }),
  accounts: identityAccounts,
  resolution: identityResolution,
  ceremonies: identityCeremonies(),
  isUserOnIdentityWrites: isLatched,
});

export function identityStorageAdapter(): AdapterFactory<BetterAuthOptions> {
  return identityStorage;
}
