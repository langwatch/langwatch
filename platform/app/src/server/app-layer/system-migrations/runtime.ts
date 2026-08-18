/**
 * The system-migrations composition root: the ONE place the generic runner
 * (@langwatch/system-migrations) meets Prisma, Redis, the authz collector
 * and the registered migrations. Worker boot calls `runSystemMigrationPass`
 * (via ./boot); the ops router reads the same composed state repository.
 *
 * Server-only - this graph reaches Prisma, Redis and the EE audit writer.
 */
import { adminEmailList } from "@ee/admin/isAdmin";
import { auditLog } from "@ee/audit-log/auditLog";
import { AuthzCollectorService } from "@langwatch/authz-server";
import {
  GRANTS_CUTOVER_MIGRATION_NAME,
  GrantsCutoverMigration,
  GrantsGenesisImportMigration,
  type GrantsLedgerEmitter,
  TeamUserBackfillMigration,
} from "@langwatch/authz-server/migration";
import { createLogger } from "@langwatch/observability";
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
import { invalidateCutoverGate } from "../authz/cutover-gate";
import { bumpAuthzEpoch } from "../authz/epoch";
import { authzGrantsCommands } from "../authz/ledger";
import { SYSTEM_ACTORS } from "../authz/ledger-actor";
import { PrismaAuthzGrantsProjectionRepository } from "../authz/repositories/authz-grants-projection.prisma.repository";
import { PrismaAuthzMigrationRepository } from "../authz/repositories/authz-migration.prisma.repository";
import { GrantsAuthzReadRepository } from "../authz/repositories/authz-read.grants.repository";
import { PrismaAuthzReadRepository } from "../authz/repositories/authz-read.prisma.repository";
import { legacyOrganizationDecide } from "../authz/repositories/cutover-parity.legacy-decide";
import { authzCollector } from "../authz/runtime";
import { cohortIncludes } from "./cohort";
import { RedisMigrationLeaseRepository } from "./repositories/migration-lease.redis.repository";
import { PrismaOrganizationTenantSource } from "./repositories/organization-tenant-source.prisma.repository";
import { PrismaSystemMigrationStateRepository } from "./repositories/system-migration-state.prisma.repository";
import { WitnessingSystemMigrationStateRepository } from "./repositories/witnessing-migration-state.repository";
import { SystemMigrationsService } from "./system-migrations.service";

const logger = createLogger("langwatch:system-migrations:runtime");

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
 * call returns (delivery-plan decision 7 / D-PR3-9).
 *
 * ENFORCEMENT FIRST, and that ordering is the whole design. The projection
 * is the enforcement authority — `AuthzCutoverProjection.onEngine` is what
 * every fork in the request path reads through the cutover gate — while the
 * ledger records HISTORY. The rollback lever exists for the incident where
 * the engine is deciding wrongly, and an event-store append can hang for
 * tens of seconds in exactly that incident; putting the append first meant
 * the operator's rollback timed out with the engine still deciding. So:
 *
 *   1. The ENFORCEMENT: the projection flipped off synchronously — the
 *      revocation-class direct write, shaped so it can only deny early.
 *      This is what makes the rollback hold with the queue stopped.
 *   2. This pod's gate cache, dropped, so the process that served the
 *      operator stops answering "on engine" from its own memory. Pod-local
 *      by design; the rest of the fleet converges on the gate's TTL.
 *   3. The EPOCH bump, so cached passports and decisions for the
 *      organization are invalidated alongside the flip.
 *   4. The FACT: `cutover_rolled_back`, so a replay reproduces the decision
 *      — BEST EFFORT. A ledger that cannot take the append must not undo an
 *      enforcement that already holds, so the failure is logged loudly and
 *      the rollback stands. What is lost is replay fidelity for one
 *      decision, never the enforcement.
 *
 * IDEMPOTENT, because the service re-runs this on every rollback retry: the
 * flip is an upsert, the cache drop and the epoch bump are safe to repeat,
 * and the command id is derived from `decidedAt` (the moment the rollback
 * was DECIDED, stable across retries of that decision) rather than from the
 * clock, so a retry dedupes on the event store's idempotency key while a
 * later rollback of a re-cutover organization gets a fresh id.
 *
 * Fleet-wide propagation is bounded by the cutover gate's 60s TTL: pods
 * already holding a positive answer stop honouring it within that window.
 * No deploy, no restart.
 */
async function rollBackAuthzCutover({
  tenantId,
  actorUserId,
  decidedAt,
}: {
  tenantId: string;
  actorUserId: string;
  decidedAt: string;
}): Promise<void> {
  const organizationId = tenantId;
  await new PrismaAuthzGrantsProjectionRepository(
    prisma,
  ).enforceCutoverRollback({ organizationId });
  invalidateCutoverGate({ organizationId });
  await bumpAuthzEpoch({ organizationId });

  const decidedAtMs = Date.parse(decidedAt);
  try {
    await (await authzGrantsCommands()).commands.rollBackCutover.send({
      tenantId: organizationId,
      organizationId,
      commandId: `cutover:rollback:${organizationId}:${decidedAt}`,
      actor: { type: "user", id: actorUserId },
      reason: "operator rollback",
      occurredAtMs: Number.isFinite(decidedAtMs) ? decidedAtMs : Date.now(),
    });
  } catch (error) {
    logger.error(
      { error, organizationId, actorUserId, decidedAt },
      "cutover rollback enforced but its ledger fact was not appended - the organization IS off the engine; replay will not show why",
    );
  }
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
      // The third parity leg: the REAL legacy resolver, not a collector over
      // the legacy head — resolver-resident quirks are exactly what the two
      // row-head collectors cannot see.
      legacyDecide: legacyOrganizationDecide(prisma),
      // A knob of its own, deliberately not SYSTEM_MIGRATIONS_COHORT: the
      // backfill and the genesis import are dark and can go wide, while the
      // cutover is the one migration that changes who decides, so it
      // advances organization by organization. Left unset, self-hosted cuts
      // over automatically once its prerequisites finalize - the in-place
      // doctrine (an operator never learns it happened), and what makes
      // that safe is the parity proof standing between the import and the
      // flip. Set, it is an explicit cohort on every deployment shape, so a
      // self-hosted operator can opt out with `none`.
      cutoverCohort: (tenantId) =>
        cohortIncludes({
          isSaaS: env.IS_SAAS === true,
          cohort: process.env.AUTHZ_CUTOVER_COHORT,
          tenantId,
        }),
      // The live platform-admin check's own parse (`adminEmailList`), read
      // per pass rather than captured, so widening ADMIN_EMAILS needs no
      // restart and the cutover import can never see a different admitted
      // set than `isAdmin()` does.
      adminEmails: adminEmailList,
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
