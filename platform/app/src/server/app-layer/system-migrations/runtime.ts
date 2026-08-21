/**
 * The system-migrations composition root: the ONE place the generic runner
 * (@langwatch/system-migrations) meets Prisma, Redis, the authz collector
 * and the registered migrations. Worker boot calls `runSystemMigrationPass`
 * (via ./boot); the ops router reads the same composed state repository.
 *
 * Server-only - this graph reaches Prisma, Redis and the EE audit writer.
 */
import { auditLog } from "@ee/audit-log/auditLog";
import { createLogger } from "@langwatch/observability";
import {
  type MigrationPassSummary,
  type SystemMigration,
  SystemMigrationRunnerService,
} from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import { env } from "~/env.mjs";
import { getPrivateClickHouseUrls } from "../../clickhouse/clickhouseClient";
import { prisma } from "../../db";
import { tryGetApp } from "../app";
import {
  type AuthzEngineLedger,
  AuthzEngineMigration,
} from "../authz/authz-engine.migration";
import { authzGrantsCommands } from "../authz/ledger";
import { PrismaAuthzMigrationRepository } from "../authz/repositories/authz-migration.prisma.repository";
import {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "./cohort";
import { RedisMigrationLeaseRepository } from "./repositories/migration-lease.redis.repository";
import { PrismaOrganizationTenantSource } from "./repositories/organization-tenant-source.prisma.repository";
import { PrismaSystemMigrationEnrollmentRepository } from "./repositories/system-migration-enrollment.prisma.repository";
import { PrismaSystemMigrationStateRepository } from "./repositories/system-migration-state.prisma.repository";
import { SystemMigrationsService } from "./system-migrations.service";

const logger = createLogger("langwatch:system-migrations:runtime");

/**
 * The cloud rollout's enrollment rows: what the ops enrollment actions write
 * and what every pass reads fresh (see `runSystemMigrationPass` and the
 * cutover's `cutoverCohort` below).
 */
/** The runner and the ops service both write through this instance. */
const systemMigrationState = new PrismaSystemMigrationStateRepository(prisma);

const enrollmentRepository = new PrismaSystemMigrationEnrollmentRepository(
  prisma,
);

/**
 * What the ops dashboard talks to. The route calls this and never the state
 * repository, so the read model stays inside the app layer.
 */
export const systemMigrationsService = new SystemMigrationsService({
  state: systemMigrationState,
  migrations: () =>
    registeredMigrations().map((migration) => ({
      name: migration.name,
      title: migration.title,
      description: migration.description,
      requiresOperatorConfirmation: migration.requiresOperatorConfirmation,
      runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
    })),
  isSaaS: () => env.IS_SAAS === true,
  enrollments: enrollmentRepository,
  // The environment's private ClickHouse routing table doubles as the list
  // of private-dataplane organizations a cohort must never sweep up - the
  // same env vars that route their data are what exclude them, so no id
  // lives in code.
  privateDataplaneOrganizationIds: () => [...getPrivateClickHouseUrls().keys()],
  audit: (entry) =>
    auditLog({
      userId: entry.userId,
      organizationId: entry.organizationId,
      action: entry.action,
      args: entry.args,
    }),
  runPass: () => runSystemMigrationPass(),
  runTargetedPass: ({ organizationId, migrationName }) =>
    runSystemMigrationTargetedPass({ organizationId, migrationName }),
  // ADR-110: one migration, and finishing it IS the switch. There is no
  // waiting stage to report, no rollback lever to register an effect for,
  // and so no dependency graph between migrations to guard.
});

/**
 * Every registered in-place migration, in the order they run per tenant.
 *
 * ADR-110 replaced the team-user backfill, the genesis import and the
 * cutover with a single migration: it streams an organization's existing
 * grants in as events, proves the projection agrees, and the moment it
 * finishes that organization is on the engine
 * (platform/app/src/server/app-layer/authz/authz-engine.migration.ts).
 * Composed per call so each pass carries a fresh emitter over the shared
 * lazy senders — a send while the App is still composing waits; an App
 * without the event-sourcing stack refuses loudly, and the migration then
 * parks its organization with an honest report.
 */
export function registeredMigrations(): SystemMigration[] {
  return [
    new AuthzEngineMigration({
      store: new PrismaAuthzMigrationRepository(prisma),
      ledger: authzEngineLedger,
      now: () => Date.now(),
    }),
  ];
}

const senders = async () => (await authzGrantsCommands()).commands;

/** The migration's door into the grants ledger — one command, one entity
 *  (ADR-110), over the same lazy senders every live write uses. Stateless:
 *  every method resolves the senders at send time, so one module-level
 *  object serves every pass. */
const authzEngineLedger: AuthzEngineLedger = {
  attachGrant: async ({ organizationId, commandId, grant }) => {
    await (await senders()).attachGrant.send({
      tenantId: organizationId,
      organizationId,
      commandId,
      grant,
    });
  },
  defineRole: async ({ organizationId, commandId, role, actor }) => {
    await (await senders()).defineRole.send({
      tenantId: organizationId,
      organizationId,
      commandId,
      role,
      actor,
    });
  },
  changeGrantRole: async ({
    organizationId,
    commandId,
    grantId,
    from,
    to,
    actor,
    occurredAtMs,
  }) => {
    await (await senders()).changeGrantRole.send({
      tenantId: organizationId,
      organizationId,
      commandId,
      grantId,
      from,
      to,
      actor,
      occurredAtMs,
    });
  },
  revokeGrant: async ({
    organizationId,
    commandId,
    grantId,
    reason,
    actor,
    occurredAtMs,
  }) => {
    await (await senders()).revokeGrant.send({
      tenantId: organizationId,
      organizationId,
      commandId,
      grantId,
      reason,
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
    await (await senders()).deleteRole.send({
      tenantId: organizationId,
      organizationId,
      commandId,
      roleId,
      actor,
      occurredAtMs,
    });
  },
};

/**
 * The runner's cohort for one pass, per (tenant, migration). On cloud every
 * enrollment is read ONCE here, fresh at the start of every pass - one
 * query instead of one per tenant per migration, and an enrollment or
 * withdrawal takes effect on the very next pass with no restart.
 * Self-hosted includes every organization for every migration the
 * installation runs at all.
 */
export async function migrationPassCohort(): Promise<
  (args: { tenantId: string; migrationName: string }) => boolean
> {
  const isSaaS = env.IS_SAAS === true;
  const enrolledByMigration = isSaaS
    ? await enrollmentRepository.findEnrolledOrganizationIdsByMigration()
    : new Map<string, Set<string>>();
  return ({ tenantId, migrationName }) =>
    organizationMigrates({
      isSaaS,
      enrolled: enrolledByMigration.get(migrationName)?.has(tenantId) ?? false,
    });
}

/**
 * The retired pacing knobs. Both were replaced by in-app enrollment (cloud)
 * and the per-migration release declaration (self-hosted); neither is
 * honored any more, and a deployment still setting one deserves to hear
 * that loudly rather than wonder why nothing paces. Once per pass, so the
 * warning recurs without flooding.
 */
function warnWhenRetiredCohortVariablesAreSet(): void {
  for (const variable of ["SYSTEM_MIGRATIONS_COHORT", "AUTHZ_CUTOVER_COHORT"]) {
    if (process.env[variable]?.trim()) {
      logger.warn(
        { variable },
        "this environment variable is retired and ignored - migration pacing is per-organization enrollment on the ops migrations page now",
      );
    }
  }
}

/**
 * One full pass over every cohort organization. Composed per call so the
 * lease token, the Redis handle and the enrollment read are all fresh - the
 * ops "run a pass now" action and the worker boot share this exact entry
 * point. Self-hosted runs only the migrations whose
 * `runsAutomaticallyOnSelfHosted` declaration has been released: the others
 * are not driven for any tenant - never attempted, parked or reported -
 * until a later release flips the declaration.
 */
/**
 * One migration for one organization, now - the ops page's targeted run.
 * The same per-organization claim as a full pass (so a targeted run can
 * never double-drive an organization a pass is working through; a summary
 * counting the organization as claimed is what the service turns into a
 * retry-shaped refusal), the same cohort read (enrollment stays the pacing
 * source of
 * truth even here - the service refuses unenrolled organizations before
 * composing this, and the cohort would skip them anyway), a tenant source
 * of exactly one id, and the migration list cut to the one asked for.
 */
export async function runSystemMigrationTargetedPass({
  organizationId,
  migrationName,
  signal,
}: {
  organizationId: string;
  migrationName: string;
  signal?: AbortSignal;
}): Promise<MigrationPassSummary> {
  const redis = tryGetApp()?.redis ?? null;
  const runner = new SystemMigrationRunnerService({
    state: systemMigrationState,
    lease: new RedisMigrationLeaseRepository(redis),
    tenants: {
      findTenantIdsAfter: async ({ cursor }) =>
        cursor === null ? [organizationId] : [],
    },
    cohort: await migrationPassCohort(),
    migrations: registeredMigrations().filter(
      (migration) =>
        migration.name === migrationName &&
        migrationRunsOnThisInstallation({
          isSaaS: env.IS_SAAS === true,
          runsAutomaticallyOnSelfHosted:
            migration.runsAutomaticallyOnSelfHosted,
        }),
    ),
  });
  return runner.runPass({ signal });
}

export async function runSystemMigrationPass(args?: {
  signal?: AbortSignal;
  /**
   * The process's Redis handle. Pass it when the App is still being composed
   * - `tryGetApp()` answers null until then, and a null handle makes the
   * lease unacquirable, which would silently turn every boot pass into a
   * no-op. Callers that run after startup (the ops action) can omit it.
   */
  redis?: Redis | Cluster | null;
}): Promise<MigrationPassSummary> {
  warnWhenRetiredCohortVariablesAreSet();
  const redis = args?.redis ?? tryGetApp()?.redis ?? null;
  const runner = new SystemMigrationRunnerService({
    state: systemMigrationState,
    lease: new RedisMigrationLeaseRepository(redis),
    tenants: new PrismaOrganizationTenantSource(prisma),
    cohort: await migrationPassCohort(),
    migrations: registeredMigrations().filter((migration) =>
      migrationRunsOnThisInstallation({
        isSaaS: env.IS_SAAS === true,
        runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
      }),
    ),
  });
  return runner.runPass({ signal: args?.signal });
}
