/**
 * The system-migrations composition root: the ONE place the generic runner
 * (@langwatch/system-migrations) meets Prisma, Redis, the authz collector
 * and the registered migrations. Worker boot calls `runSystemMigrationPass`
 * (via ./boot); the ops router reads the same composed state repository.
 *
 * Server-only - this graph reaches Prisma, Redis and the EE audit writer.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import { AuthzCollectorService } from "@langwatch/authz-server";
import {
  GRANTS_CUTOVER_MIGRATION_NAME,
  GrantsCutoverMigration,
  GrantsGenesisImportMigration,
  type GrantsLedgerEmitter,
  TeamUserBackfillMigration,
} from "@langwatch/authz-server/migration";
import {
  type MigrationPassSummary,
  type SystemMigration,
  SystemMigrationRunnerService,
} from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import { env } from "~/env.mjs";
import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "../../db";
import { tryGetApp } from "../app";
import { bumpAuthzEpoch } from "../authz/epoch";
import { authzGrantsCommands } from "../authz/ledger";
import { SYSTEM_ACTORS } from "../authz/ledger-actor";
import { PrismaAuthzGrantsProjectionRepository } from "../authz/repositories/authz-grants-projection.prisma.repository";
import { PrismaAuthzMigrationRepository } from "../authz/repositories/authz-migration.prisma.repository";
import { GrantsAuthzReadRepository } from "../authz/repositories/authz-read.grants.repository";
import { PrismaAuthzReadRepository } from "../authz/repositories/authz-read.prisma.repository";
import { authzCollector } from "../authz/runtime";
import { cohortIncludes } from "./cohort";
import { RedisMigrationLeaseRepository } from "./repositories/migration-lease.redis.repository";
import { PrismaOrganizationTenantSource } from "./repositories/organization-tenant-source.prisma.repository";
import { PrismaSystemMigrationStateRepository } from "./repositories/system-migration-state.prisma.repository";
import { WitnessingSystemMigrationStateRepository } from "./repositories/witnessing-migration-state.repository";
import { SystemMigrationsService } from "./system-migrations.service";

/**
 * The composed state repository, wrapped so every lifecycle transition is
 * witnessed as a ledger fact (best-effort; the synchronous write stays the
 * latch). The runner and the ops service both write through this instance,
 * so operator rollbacks are witnessed too. Routes must not touch it - they
 * go through `systemMigrationsService` below.
 */
const systemMigrationState = new WitnessingSystemMigrationStateRepository({
  inner: new PrismaSystemMigrationStateRepository(prisma),
  witness: async ({
    migrationName,
    tenantId,
    status,
    report,
    occurredAtMs,
  }) => {
    await (
      await authzGrantsCommands()
    ).commands.recordMigrationTenantState.send({
      tenantId,
      organizationId: tenantId,
      commandId: `runner:${migrationName}:${tenantId}:${status}:${occurredAtMs}`,
      migrationName,
      status,
      report,
      actor: { type: "system", id: SYSTEM_ACTORS.migrationRunner },
      occurredAtMs,
    });
  },
  now: () => Date.now(),
});

/**
 * What the ops dashboard talks to. The route calls this and never the state
 * repository, so the read model stays inside the app layer.
 */
export const systemMigrationsService = new SystemMigrationsService({
  state: systemMigrationState,
  migrationNames: () =>
    registeredMigrations().map((migration) => migration.name),
  runPass: () => runSystemMigrationPass(),
  rollbackEffects: {
    [GRANTS_CUTOVER_MIGRATION_NAME]: rollBackAuthzCutover,
  },
});

/**
 * Rolling one organization off the engine, applied before the operator's
 * call returns (delivery-plan decision 7 / D-PR3-9). Three steps, in this
 * order:
 *
 *   1. The FACT: `cutover_rolled_back`, so the ledger records the decision
 *      and a replay reproduces it. The commandId carries the moment, since
 *      an organization may legitimately be rolled back more than once and
 *      each is its own event.
 *   2. The ENFORCEMENT: the projection flipped off synchronously — the
 *      revocation-class direct write, shaped so it can only deny early.
 *      This is what makes the rollback hold with the queue stopped.
 *   3. The EPOCH bump, so cached passports and decisions for the
 *      organization are invalidated alongside the flip.
 *
 * Fleet-wide propagation is bounded by the cutover gate's 60s TTL: pods
 * already holding a positive answer stop honouring it within that window.
 * No deploy, no restart.
 */
async function rollBackAuthzCutover({
  tenantId,
  actorUserId,
}: {
  tenantId: string;
  actorUserId: string;
}): Promise<void> {
  const organizationId = tenantId;
  await (await authzGrantsCommands()).commands.rollBackCutover.send({
    tenantId: organizationId,
    organizationId,
    commandId: `cutover:rollback:${organizationId}:${Date.now()}`,
    actor: { type: "user", id: actorUserId },
    reason: "operator rollback",
    occurredAtMs: Date.now(),
  });
  await new PrismaAuthzGrantsProjectionRepository(
    prisma,
  ).enforceCutoverRollback({ organizationId });
  await bumpAuthzEpoch({ organizationId });
}

/**
 * The migrations' door into the ledger, over the shared lazy senders in
 * `server/app-layer/authz/ledger.ts` (a send while the App is still composing waits;
 * an App without the event-sourcing stack refuses loudly — the migration
 * then parks its organization with an honest report, and the state witness
 * logs and moves on).
 */
function grantsLedgerEmitter(): GrantsLedgerEmitter {
  return {
    attachGrants: async ({ organizationId, commandId, grants }) => {
      await (await authzGrantsCommands()).commands.attachGrants.send({
        tenantId: organizationId,
        organizationId,
        commandId,
        grants,
      });
    },
    defineRoles: async ({ organizationId, commandId, roles, actor }) => {
      await (await authzGrantsCommands()).commands.defineRoles.send({
        tenantId: organizationId,
        organizationId,
        commandId,
        roles,
        actor,
      });
    },
    revokeGrants: async ({
      organizationId,
      commandId,
      revocations,
      actor,
      occurredAtMs,
    }) => {
      await (await authzGrantsCommands()).commands.revokeGrants.send({
        tenantId: organizationId,
        organizationId,
        commandId,
        revocations,
        actor,
        occurredAtMs,
      });
    },
    deleteRole: async ({
      organizationId,
      commandId,
      roleId,
      actor,
      occurredAtMs,
    }) => {
      await (await authzGrantsCommands()).commands.deleteRole.send({
        tenantId: organizationId,
        organizationId,
        commandId,
        roleId,
        actor,
        occurredAtMs,
      });
    },
    proveMigrationParity: async ({
      organizationId,
      commandId,
      diffs,
      occurredAtMs,
    }) => {
      await (await authzGrantsCommands()).commands.proveMigrationParity.send({
        tenantId: organizationId,
        organizationId,
        commandId,
        diffs,
        occurredAtMs,
      });
    },
    completeCutover: async ({
      organizationId,
      commandId,
      actor,
      occurredAtMs,
    }) => {
      await (await authzGrantsCommands()).commands.completeCutover.send({
        tenantId: organizationId,
        organizationId,
        commandId,
        actor,
        occurredAtMs,
      });
    },
  };
}

/** Every registered in-place migration, in the order they run per tenant. */
export function registeredMigrations(): SystemMigration[] {
  return [
    new TeamUserBackfillMigration({
      repository: new PrismaAuthzMigrationRepository(prisma),
      collectGrants: (args) => authzCollector.collectGrants(args),
      ledger: grantsLedgerEmitter(),
      audit: (entry) =>
        auditLog({ ...entry, metadata: entry.metadata as Prisma.JsonObject }),
      bumpEpoch: bumpAuthzEpoch,
      now: () => Date.now(),
    }),
    // After the backfill on purpose: the backfill's grants are legacy rows
    // by the time this runs, so the import adopts them like any other.
    new GrantsGenesisImportMigration({
      repository: new PrismaAuthzMigrationRepository(prisma),
      ledger: grantsLedgerEmitter(),
      now: () => Date.now(),
    }),
    // LAST, and it checks that for itself: the cutover imports what the
    // other two leave behind and then flips the organization onto the
    // engine, so it holds any tenant whose earlier migrations have not
    // finalized.
    new GrantsCutoverMigration({
      repository: new PrismaAuthzMigrationRepository(prisma),
      ledger: grantsLedgerEmitter(),
      // The parity proof's two readers, composed DIRECTLY over the two
      // heads and never through `CutoverAwareAuthzReadRepository`: the
      // proof has to compare the legacy head with the ledger's own while
      // the organization is still on legacy, and the forking decorator
      // would answer from one head twice.
      collectors: {
        legacy: new AuthzCollectorService(
          new PrismaAuthzReadRepository(prisma),
        ),
        grants: new AuthzCollectorService(
          new GrantsAuthzReadRepository(prisma),
        ),
      },
      // A knob of its own, deliberately not SYSTEM_MIGRATIONS_COHORT: the
      // backfill and the genesis import are dark and can go wide, while the
      // cutover is the one migration that changes who decides, so it
      // advances organization by organization. Self-hosted cuts over
      // automatically once its prerequisites finalize - the in-place
      // doctrine (an operator never learns it happened), and what makes
      // that safe is the parity proof standing between the import and the
      // flip.
      cutoverCohort: (tenantId) =>
        cohortIncludes({
          isSaaS: env.IS_SAAS === true,
          cohort: process.env.AUTHZ_CUTOVER_COHORT,
          tenantId,
        }),
      // The same list the live platform-admin check parses, read per pass
      // rather than captured, so widening it needs no restart.
      adminEmails: () => (process.env.ADMIN_EMAILS ?? "").split(","),
      now: () => Date.now(),
    }),
  ];
}

/**
 * One full pass over every cohort organization. Composed per call so the
 * lease token, the Redis handle and the cohort env read are all fresh -
 * the ops "run a pass now" action and the worker boot share this exact
 * entry point.
 */
export async function runSystemMigrationPass(args?: {
  signal?: AbortSignal;
  /**
   * The process's Redis handle. Pass it when the App is still being composed
   * - `tryGetApp()` answers null until then, and a null handle makes the
   * lease unacquirable, which would silently turn every boot pass into a
   * no-op. Callers that run after startup (the ops action) can omit it.
   */
  redis?: Redis | Cluster | null;
}): Promise<MigrationPassSummary | null> {
  const redis = args?.redis ?? tryGetApp()?.redis ?? null;
  const runner = new SystemMigrationRunnerService({
    state: systemMigrationState,
    lease: new RedisMigrationLeaseRepository(redis),
    tenants: new PrismaOrganizationTenantSource(prisma),
    cohort: (tenantId) =>
      cohortIncludes({
        isSaaS: env.IS_SAAS === true,
        cohort: process.env.SYSTEM_MIGRATIONS_COHORT,
        tenantId,
      }),
    migrations: registeredMigrations(),
  });
  return runner.runPass({ signal: args?.signal });
}
