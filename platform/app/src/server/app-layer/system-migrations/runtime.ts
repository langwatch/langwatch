/**
 * The system-migrations composition root: the ONE place the generic runner
 * (@langwatch/system-migrations) meets Prisma, Redis, the authz collector
 * and the registered migrations. Worker boot calls `runSystemMigrationPass`
 * (via ./boot); the ops router reads the same composed state repository.
 *
 * Server-only - this graph reaches Prisma, Redis and the EE audit writer.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import {
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
import { PrismaAuthzMigrationRepository } from "../authz/repositories/authz-migration.prisma.repository";
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
});

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
