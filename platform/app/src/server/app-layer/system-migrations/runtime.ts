/**
 * The system-migrations composition root: the ONE place the generic runner
 * (@langwatch/system-migrations) meets Prisma, Redis, the authz collector
 * and the registered migrations. Worker boot calls `runSystemMigrationPass`
 * (via ./boot); the ops router reads the same composed state repository.
 *
 * Server-only - this graph reaches Prisma, Redis and the EE audit writer.
 */
import { auditLog } from "~/runtime/app/features/audit-log";
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
  identifierBackfillMigration,
  identityNewbornReconciliation,
  identitySecretHealMigration,
} from "../identity/runtime";
import { migrationRunsOnThisInstallation, organizationMigrates } from "./cohort";
import { MigrationNotAvailableOnInstallationError } from "./errors";
import { RedisMigrationLeaseRepository } from "./repositories/migration-lease.redis.repository";
import { PrismaOrganizationTenantSource } from "./repositories/organization-tenant-source.prisma.repository";
import { PrismaSystemMigrationEnrollmentRepository } from "./repositories/system-migration-enrollment.prisma.repository";
import { PrismaSystemMigrationStateRepository } from "./repositories/system-migration-state.prisma.repository";
import {
  PrismaOrganizationMemberTenantSource,
  PrismaUserTenantSource,
} from "./repositories/user-tenant-source.prisma.repository";
import { SystemMigrationsService } from "./system-migrations.service";

const logger = createLogger("langwatch:system-migrations:runtime");

/** The runner and the ops service both write through this instance. */
const systemMigrationState = new PrismaSystemMigrationStateRepository(prisma);

const enrollmentRepository = new PrismaSystemMigrationEnrollmentRepository(prisma);

/**
 * What the ops dashboard talks to. The route calls this and never the state
 * repository, so the read model stays inside the app layer.
 */
export const systemMigrationsService = new SystemMigrationsService({
  state: systemMigrationState,
  migrations: () => [
    ...registeredMigrations().map((migration) =>
      declarationOf({ migration, tenant: "organization" }),
    ),
    ...registeredUserMigrations().map((migration) =>
      declarationOf({ migration, tenant: "user" }),
    ),
  ],
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

/** What the ops service reads of a migration: its declaration plus the axis
 *  the runner drives it over (ADR-101 §6). */
function declarationOf({
  migration,
  tenant,
}: {
  migration: SystemMigration;
  tenant: "organization" | "user";
}) {
  return {
    name: migration.name,
    title: migration.title,
    description: migration.description,
    requiresOperatorConfirmation: migration.requiresOperatorConfirmation,
    runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
    enrolledAutomatically: migration.enrolledAutomatically,
    tenant,
  };
}

/**
 * Every registered in-place migration, in the order they run per tenant.
 *
 * Feature-owned migrations arrive from runtime composition. The automatic
 * worker pass receives them explicitly before App initialization; operator
 * calls resolve the same instance from the initialized App.
 */
export function registeredMigrations(
  additionalMigrations: readonly SystemMigration[] = [],
): SystemMigration[] {
  const runtimeMigration = tryGetApp()?.authzMigration;
  const migrations = [
    ...(runtimeMigration ? [runtimeMigration] : []),
    ...additionalMigrations,
    // D04 (ADR-117 §5) — the legacy-SSO grandfather migration — is NOT
    // registered here, and that is deliberate rather than an oversight.
    //
    // It was registered briefly and reverted. `main` does register it, and on
    // this branch it looked like a dropped registration, but the same wave
    // also removed `createSsoConnectionPipeline` from the registry. The
    // migration writes through `SsoConnectionService.grandfatherConnection`,
    // which commits through `SsoConnectionLedgerWriter`, which resolves its
    // command sender from that pipeline and throws when it is absent. So
    // registering it without the pipeline converts a migration that silently
    // does nothing into one that throws a plain `Error` per tenant carrying
    // legacy SSO — a generic "unknown" failure, and worse than the no-op.
    //
    // Restoring this means restoring the pipeline first (and with it
    // `ConnectionTeardownPort`'s only implementation, deleted as orphaned
    // because the registration had already gone). Half the chain is worse
    // than none of it.
  ];
  return [
    ...new Map(migrations.map((migration) => [migration.name, migration])).values(),
  ];
}

/**
 * The USER-rooted migrations (ADR-101 §6): their tenant is the user, so they
 * ride a second runner over the user tenant source rather than joining
 * `registeredMigrations`. Same state table, same lease, same ops page — only
 * the tenant axis differs.
 */
export function registeredUserMigrations(): SystemMigration[] {
  // The heal pass rides beside the backfill rather than inside it: the user
  // it repairs is FINALIZED, and the runner skips a terminal record, so a
  // step inside the backfill would never run for exactly the population that
  // needs it (ADR-116 §4).
  return [identifierBackfillMigration(), identitySecretHealMigration()];
}

/**
 * Which registered migrations admit every cloud tenant with no enrollment
 * row, by name. Read from the migrations themselves so the declaration and
 * the cohort can never disagree; a name nothing registered answers to is
 * absent, which reads as "not automatic" - the safe side.
 */
function automaticallyEnrolledMigrationNames(): Set<string> {
  return new Set(
    [...registeredMigrations(), ...registeredUserMigrations()]
      .filter((migration) => migration.enrolledAutomatically)
      .map((migration) => migration.name),
  );
}

/**
 * The runner's cohort for one pass, per (tenant, migration). On cloud every
 * enrollment is read ONCE here, fresh at the start of every pass - one
 * query instead of one per tenant per migration, and an enrollment or
 * withdrawal takes effect on the very next pass with no restart. A migration
 * declaring `enrolledAutomatically` admits every organization without
 * consulting that read at all - including one running a private data plane,
 * whose organization-rooted appends the event store already places on its
 * own instance. Self-hosted includes every organization for every migration
 * the installation runs at all.
 */
export async function migrationPassCohort(): Promise<
  (args: { tenantId: string; migrationName: string }) => boolean
> {
  const isSaaS = env.IS_SAAS === true;
  const automatic = automaticallyEnrolledMigrationNames();
  // Still read on cloud, and still fresh: the migrations that have not
  // declared themselves automatic are paced by exactly these rows.
  const enrolledByMigration = isSaaS
    ? await enrollmentRepository.findEnrolledOrganizationIdsByMigration()
    : new Map<string, Set<string>>();
  return ({ tenantId, migrationName }) =>
    organizationMigrates({
      isSaaS,
      enrolledAutomatically: automatic.has(migrationName),
      enrolled: enrolledByMigration.get(migrationName)?.has(tenantId) ?? false,
    });
}

/**
 * The user-rooted pass's cohort. For a migration still paced by enrollment -
 * every user-rooted migration registered today - the ops page enrolls
 * ORGANIZATIONS, and a user is in the cohort when any organization they
 * belong to is enrolled for it. Self-hosted admits every user, as it admits
 * every organization. Enrollment is read once, fresh, at the start of each
 * pass; membership is answered per candidate user with two cheap indexed
 * reads rather than materializing every enrolled organization's member list
 * into memory (the runner visits each user once per pass). Members of
 * private-dataplane organizations are excluded exactly as those
 * organizations are. A user outside every organization has nothing to enroll
 * them on cloud and stays on the legacy path until they join one; their
 * sign-in is unaffected (the write gate answers false; the D03 read fork
 * falls back to legacy routing).
 *
 * A user-rooted migration declaring `enrolledAutomatically` admits every
 * user instead, private-dataplane members still excepted - the same rule the
 * organization cohort applies, on this axis.
 */
export async function userMigrationPassCohort(): Promise<
  (args: { tenantId: string; migrationName: string }) => Promise<boolean>
> {
  if (env.IS_SAAS !== true) return async () => true;
  const automatic = automaticallyEnrolledMigrationNames();
  const enrolledByMigration =
    await enrollmentRepository.findEnrolledOrganizationIdsByMigration();
  // The same exclusion the organization cohort applies: a private-dataplane
  // organization is never swept up, and neither are its members - a user's
  // identity events would otherwise land in the shared platform log while
  // the organization's own data stays on its private instance. It survives
  // an automatic enrollment too: that declaration widens WHO the rollout
  // reaches, and this exclusion is not pacing but where the events land.
  const privateOrganizationIds = [...getPrivateClickHouseUrls().keys()];
  const belongsToPrivateDataplane = async (
    userId: string,
  ): Promise<boolean> => {
    if (privateOrganizationIds.length === 0) return false;
    const membership = await prisma.organizationUser.findFirst({
      where: { userId, organizationId: { in: privateOrganizationIds } },
      select: { userId: true },
    });
    return membership !== null;
  };
  const enrolledPublicByMigration = new Map<string, string[]>();
  for (const migration of registeredUserMigrations()) {
    enrolledPublicByMigration.set(
      migration.name,
      [
        ...(enrolledByMigration.get(migration.name) ?? new Set<string>()),
      ].filter((id) => !privateOrganizationIds.includes(id)),
    );
  }
  return async ({ tenantId, migrationName }) => {
    if (automatic.has(migrationName)) {
      return !(await belongsToPrivateDataplane(tenantId));
    }
    const organizationIds = enrolledPublicByMigration.get(migrationName) ?? [];
    if (organizationIds.length === 0) return false;
    if (await belongsToPrivateDataplane(tenantId)) return false;
    const enrolledMembership = await prisma.organizationUser.findFirst({
      where: { userId: tenantId, organizationId: { in: organizationIds } },
      select: { userId: true },
    });
    return enrolledMembership !== null;
  };
}

function userMigrationsForThisInstallation(): SystemMigration[] {
  return registeredUserMigrations().filter((migration) =>
    migrationRunsOnThisInstallation({
      isSaaS: env.IS_SAAS === true,
      runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
    }),
  );
}

function mergeSummaries(
  a: MigrationPassSummary,
  b: MigrationPassSummary,
): MigrationPassSummary {
  return {
    tenantsSeen: a.tenantsSeen + b.tenantsSeen,
    finalized: a.finalized + b.finalized,
    held: a.held + b.held,
    parked: a.parked + b.parked,
    skipped: a.skipped + b.skipped,
    alreadyFinalized: a.alreadyFinalized + b.alreadyFinalized,
    alreadyRolledBack: a.alreadyRolledBack + b.alreadyRolledBack,
    claimed: a.claimed + b.claimed,
    // Summed like any other count: the convergence loop stops when a whole
    // pass - both legs - moved nothing, so one leg still advancing has to
    // keep the merged answer non-zero.
    advanced: a.advanced + b.advanced,
  };
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
 * One migration for one organization, now - the ops page's targeted run.
 * The same per-organization claim as a full pass (so a targeted run can
 * never double-drive an organization a pass is working through; a summary
 * counting the organization as claimed is what the service turns into a
 * retry-shaped refusal), the same cohort read (the cohort stays the source
 * of truth even here - the service refuses an organization outside it before
 * composing this, and the cohort would skip it anyway), a tenant source of
 * exactly one id, and the migration list cut to the one asked for.
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
  // A user-rooted migration's targeted run keeps the operator's org-shaped
  // lever: the named organization's MEMBERS are the tenants (the service
  // already refused an organization outside the cohort, so every member the
  // source yields is the cohort).
  const userMigration = userMigrationsForThisInstallation().find(
    (migration) => migration.name === migrationName,
  );
  if (userMigration) {
    // The same exclusion `userMigrationPassCohort` applies: a
    // private-dataplane organization's members are never swept up - their
    // identity events would land in the shared platform log while the
    // organization's own data stays on its private instance - and neither
    // enrollment nor an automatic declaration carries that rule, so the
    // targeted run refuses outright.
    if (
      env.IS_SAAS === true &&
      getPrivateClickHouseUrls().has(organizationId)
    ) {
      throw new MigrationNotAvailableOnInstallationError();
    }
    const runner = new SystemMigrationRunnerService({
      state: systemMigrationState,
      lease: new RedisMigrationLeaseRepository(redis),
      tenants: new PrismaOrganizationMemberTenantSource({
        prisma,
        organizationId,
      }),
      cohort: () => true,
      migrations: [userMigration],
    });
    return runner.runPass({ signal });
  }
  const runner = new SystemMigrationRunnerService({
    state: systemMigrationState,
    lease: new RedisMigrationLeaseRepository(redis),
    tenants: {
      findTenantIdsAfter: async ({ cursor }) => (cursor === null ? [organizationId] : []),
    },
    cohort: await migrationPassCohort(),
    migrations: registeredMigrations().filter(
      (migration) =>
        migration.name === migrationName &&
        migrationRunsOnThisInstallation({
          isSaaS: env.IS_SAAS === true,
          runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
        }),
    ),
  });
  return runner.runPass({ signal });
}

/**
 * One full pass over every cohort organization, then over every cohort user.
 * Composed per call so the lease token, the Redis handle and the enrollment
 * read are all fresh - the ops "run a pass now" action and the worker boot
 * share this exact entry point. Self-hosted runs only the migrations whose
 * `runsAutomaticallyOnSelfHosted` declaration has been released: the others
 * are not driven for any tenant - never attempted, parked or reported -
 * until a later release flips the declaration.
 */
export async function runSystemMigrationPass(args?: {
  signal?: AbortSignal;
  additionalMigrations?: readonly SystemMigration[];
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
    migrations: registeredMigrations(args?.additionalMigrations).filter((migration) =>
      migrationRunsOnThisInstallation({
        isSaaS: env.IS_SAAS === true,
        runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
      }),
    ),
  });
  // The USER-rooted leg (ADR-101 §6): the same lease, state table and
  // enrollment rows, driven over users. Both legs' cohorts resolve BEFORE
  // either pass starts, so the two legs read enrollment at the same moment -
  // an operator enrolling mid-pass moves both legs on the next pass, never
  // one leg now and the other later.
  const userMigrations = userMigrationsForThisInstallation();
  const userCohort =
    userMigrations.length === 0 ? null : await userMigrationPassCohort();
  const organizationSummary = await runner.runPass({ signal: args?.signal });
  if (userCohort === null) {
    await sweepAbandonedNewborns();
    return organizationSummary;
  }
  const userRunner = new SystemMigrationRunnerService({
    state: systemMigrationState,
    lease: new RedisMigrationLeaseRepository(redis),
    tenants: new PrismaUserTenantSource(prisma),
    cohort: userCohort,
    migrations: userMigrations,
  });
  const summary = mergeSummaries(
    organizationSummary,
    await userRunner.runPass({ signal: args?.signal }),
  );
  await sweepAbandonedNewborns();
  return summary;
}

/**
 * The born-finalized entrance's reconciliation sweep (ADR-116 §3), on the
 * same cadence as the passes and never terminal — a required companion to the
 * entrance rather than optional hygiene.
 *
 * A LEG of the pass rather than a registered `SystemMigration`, because what
 * it hunts has no tenant a runner could visit. The runner drives the tenants
 * a source enumerates, and the user tenant source enumerates `User` rows; an
 * abandoned entrance is precisely a claim with no user row behind it, so a
 * per-tenant migration would never reach one.
 *
 * Its failure is never the pass's: the sweep removes rows the pass did not
 * write, and a pass that reported nothing because a sweep threw would hide
 * the migration outcome an operator asked for.
 */
async function sweepAbandonedNewborns(): Promise<void> {
  try {
    await identityNewbornReconciliation().runPass();
  } catch (error) {
    logger.warn(
      { error },
      "the abandoned-newborn sweep failed; the claims stay and the next pass retries",
    );
  }
}
