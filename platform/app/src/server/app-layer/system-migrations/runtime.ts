/**
 * The system-migrations composition root: the ONE place the generic runner
 * (@langwatch/system-migrations) meets Prisma, Redis, the authz collector
 * and the registered migrations. Worker boot calls `runSystemMigrationPass`
 * (via ./boot); the ops router reads the same composed state repository.
 *
 * Server-only - this graph reaches Prisma, Redis and the EE audit writer.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import { TeamUserBackfillMigration } from "@langwatch/authz-server";
import { generate } from "@langwatch/ksuid";
import {
  type MigrationPassSummary,
  type SystemMigration,
  SystemMigrationRunnerService,
} from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import { env } from "~/env.mjs";
import type { Prisma } from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";
import { bumpAuthzEpoch } from "../../authz/epoch";
import { PrismaAuthzMigrationRepository } from "../../authz/repositories/authz-migration.prisma.repository";
import { authzCollector } from "../../authz/runtime";
import { prisma } from "../../db";
import { tryGetApp } from "../app";
import { cohortIncludes } from "./cohort";
import { RedisMigrationLeaseRepository } from "./repositories/migration-lease.redis.repository";
import { PrismaOrganizationTenantSource } from "./repositories/organization-tenant-source.prisma.repository";
import { PrismaSystemMigrationStateRepository } from "./repositories/system-migration-state.prisma.repository";

/** The composed state repository, shared with the ops router's readers. */
export const systemMigrationState = new PrismaSystemMigrationStateRepository(
  prisma,
);

/** Every registered in-place migration, in the order they run per tenant. */
export function registeredMigrations(): SystemMigration[] {
  return [
    new TeamUserBackfillMigration({
      repository: new PrismaAuthzMigrationRepository(prisma),
      collectGrants: (args) => authzCollector.collectGrants(args),
      audit: (entry) =>
        auditLog({ ...entry, metadata: entry.metadata as Prisma.JsonObject }),
      bumpEpoch: bumpAuthzEpoch,
      newBindingId: () => generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
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
