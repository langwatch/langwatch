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
  type GrantsLedgerEmitter,
  TeamUserBackfillMigration,
} from "@langwatch/authz-server";
import {
  type MigrationPassSummary,
  type SystemMigration,
  SystemMigrationRunnerService,
} from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import { env } from "~/env.mjs";
import type { Prisma } from "~/generated/prisma/client";
import { AUTHZ_GRANTS_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/authz-grants/schemas/constants";
import { bumpAuthzEpoch } from "../../authz/epoch";
import { PrismaAuthzMigrationRepository } from "../../authz/repositories/authz-migration.prisma.repository";
import { authzCollector } from "../../authz/runtime";
import { prisma } from "../../db";
import { tryGetApp } from "../app";
import { cohortIncludes } from "./cohort";
import { RedisMigrationLeaseRepository } from "./repositories/migration-lease.redis.repository";
import { PrismaOrganizationTenantSource } from "./repositories/organization-tenant-source.prisma.repository";
import { PrismaSystemMigrationStateRepository } from "./repositories/system-migration-state.prisma.repository";
import { SystemMigrationsService } from "./system-migrations.service";

/** The composed state repository. The runner uses it; routes must not - they
 *  go through `systemMigrationsService` below. */
const systemMigrationState = new PrismaSystemMigrationStateRepository(prisma);

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
 * The backfill's door into the grants ledger, resolved lazily at send time
 * (the pipeline is being registered while this module loads). A disabled
 * event-sourcing stack throws rather than letting DisabledPipeline swallow
 * the send - the organization then parks with an honest report instead of
 * timing out against a projection that will never run.
 */
function grantsLedgerEmitter(): GrantsLedgerEmitter {
  const commandsFor = () => {
    const app = tryGetApp();
    if (!app?.eventSourcing?.isEnabled) {
      throw new Error(
        "grants backfill requires the event-sourcing stack; organization parked",
      );
    }
    return app.eventSourcing.getPipeline(
      AUTHZ_GRANTS_PIPELINE_NAME as never,
    ) as unknown as {
      commands: {
        attachGrants: { send: (data: unknown) => Promise<unknown> };
        proveMigrationParity: { send: (data: unknown) => Promise<unknown> };
      };
    };
  };
  return {
    attachGrants: async ({ organizationId, commandId, grants }) => {
      await commandsFor().commands.attachGrants.send({
        tenantId: organizationId,
        organizationId,
        commandId,
        grants,
      });
    },
    proveMigrationParity: async ({
      organizationId,
      commandId,
      diffs,
      occurredAtMs,
    }) => {
      await commandsFor().commands.proveMigrationParity.send({
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
