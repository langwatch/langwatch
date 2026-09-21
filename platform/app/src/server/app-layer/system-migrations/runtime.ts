/**
 * The system-migrations composition root: the ONE place the generic runner
 * (@langwatch/system-migrations) meets Prisma, Redis, the authz collector
 * and the registered migrations. The startup preflight calls
 * `runSystemMigrationPass` via ./boot; the ops router reads the same state.
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
import type { ProcessRole } from "../config";
import {
  connectionGrandfatherMigration,
  identifierBackfillMigration,
  identityAddressLockReaper,
  identitySecretHealMigration,
} from "../identity/runtime";
import {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "./cohort";
import { SystemMigrationRedriveService } from "./redrive";
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

/** The cloud rollout's enrollment rows: what the ops enrollment actions
 *  write and what every pass reads fresh (`migrationPassCohort`,
 *  `userMigrationPassCohort`). */

const enrollmentRepository = new PrismaSystemMigrationEnrollmentRepository(
  prisma,
);

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
  runTargetedPass: (target) =>
    "userId" in target
      ? runSystemMigrationUserPass(target)
      : runSystemMigrationTargetedPass(target),
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
    // D04 records the configured legacy route without treating the old domain
    // string as ownership evidence. Existing sign-in remains compatible, but
    // activation, linking, and new-person trust still require qualified proof.
    connectionGrandfatherMigration(),
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
 * Builds the user cohort once per pass. Automatic migrations admit every
 * user. Paced migrations admit members of enrolled organizations, querying
 * one user's memberships at a time to avoid a growing SQL `IN` list.
 */
export async function userMigrationPassCohort(): Promise<
  (args: { tenantId: string; migrationName: string }) => Promise<boolean>
> {
  if (env.IS_SAAS !== true) return async () => true;
  const automatic = automaticallyEnrolledMigrationNames();
  const enrolledByMigration =
    await enrollmentRepository.findEnrolledOrganizationIdsByMigration();
  return async ({ tenantId, migrationName }) => {
    if (automatic.has(migrationName)) return true;
    const enrolled = enrolledByMigration.get(migrationName);
    if (!enrolled || enrolled.size === 0) return false;
    // Read as a relation of the user, not as a top-level OrganizationUser
    // query: that model is org-guarded (dbOrganizationIdProtection), and a
    // userId-only predicate has no admitted shape there.
    const user = await prisma.user.findUnique({
      where: { id: tenantId },
      select: { orgMemberships: { select: { organizationId: true } } },
    });
    return (user?.orgMemberships ?? []).some((membership) =>
      enrolled.has(membership.organizationId),
    );
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

function organizationMigrationsForThisInstallation(): SystemMigration[] {
  return registeredMigrations().filter((migration) =>
    migrationRunsOnThisInstallation({
      isSaaS: env.IS_SAAS === true,
      runsAutomaticallyOnSelfHosted: migration.runsAutomaticallyOnSelfHosted,
    }),
  );
}

/**
 * The names a pass on THIS installation could still move, both axes. The
 * re-drive's gate asks the state table about exactly these: a row belonging
 * to a migration this installation does not run is not work waiting, it is
 * another deployment's row in a shared table, and sweeping for it would keep
 * the gate permanently open.
 */
export function migrationNamesForThisInstallation(): string[] {
  return [
    ...organizationMigrationsForThisInstallation(),
    ...userMigrationsForThisInstallation(),
  ].map((migration) => migration.name);
}

/**
 * The periodic re-drive (D2): a worker-only cadence over the pass above, so
 * a tenant that parks an hour after boot heals itself instead of waiting for
 * the next deploy or an operator's click. Composed here because this is the
 * one place the runner meets Prisma, and gated on the state table so an
 * installation with nothing parked or held pays one row read per tick.
 */
export function createSystemMigrationRedrive({
  processRole,
}: {
  processRole: ProcessRole | undefined;
}): SystemMigrationRedriveService {
  return new SystemMigrationRedriveService({
    processRole,
    logger: createLogger("langwatch:system-migrations:redrive"),
    hasTenantAwaitingRedrive: () =>
      systemMigrationState.hasTenantAwaitingRedrive({
        migrationNames: migrationNamesForThisInstallation(),
      }),
    runPass: () => runSystemMigrationPass(),
  });
}

function mergeSummaries(
  a: MigrationPassSummary,
  b: MigrationPassSummary,
): MigrationPassSummary {
  return {
    tenantsSeen: a.tenantsSeen + b.tenantsSeen,
    finalized: a.finalized + b.finalized,
    held: a.held + b.held,
    finiteHeld: (a.finiteHeld ?? 0) + (b.finiteHeld ?? 0),
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

/** One user's identity adoption, with the normal user cohort and lease.
 * Unlike the operator's organization-shaped pass, this never scans peers. */
export async function runSystemMigrationUserPass({
  userId,
  migrationName,
  signal,
}: {
  userId: string;
  migrationName: string;
  signal?: AbortSignal;
}): Promise<MigrationPassSummary> {
  const runner = new SystemMigrationRunnerService({
    state: systemMigrationState,
    lease: new RedisMigrationLeaseRepository(tryGetApp()?.redis ?? null),
    tenants: {
      findTenantIdsAfter: async ({ cursor }) =>
        cursor === null ? [userId] : [],
    },
    cohort: await userMigrationPassCohort(),
    migrations: userMigrationsForThisInstallation().filter(
      (migration) => migration.name === migrationName,
    ),
  });
  return runner.runPass({ signal });
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

/**
 * One full pass over every cohort organization, then over every cohort user.
 * Composed per call so the lease token, the Redis handle and the enrollment
 * read are all fresh - the ops "run a pass now" action and startup preflight
 * share this exact entry point. Self-hosted runs only the migrations whose
 * `runsAutomaticallyOnSelfHosted` declaration has been released: the others
 * are not driven for any tenant - never attempted, parked or reported -
 * until a later release flips the declaration.
 */
export async function runSystemMigrationPass(args?: {
  signal?: AbortSignal;
  /**
   * The process's Redis handle. Pass it when the App is still being composed
   * - `tryGetApp()` answers null until then, and a null handle makes the
   * lease unacquirable, which would silently turn every preflight pass into a
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
    migrations: organizationMigrationsForThisInstallation(),
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
    await reapOrphanedAddressLocks();
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
  await reapOrphanedAddressLocks();
  return summary;
}

/**
 * The address lock's reap (ADR-116 §6), on the same cadence as the passes and
 * never terminal — a required companion to the lock rather than optional
 * hygiene. A ceremony that claimed an address and then failed leaves a lock
 * no live identifier backs, and without this nobody could take that address
 * again.
 *
 * A LEG of the pass rather than a registered `SystemMigration`, because what
 * it hunts has no tenant a runner could visit. The runner drives the tenants
 * a source enumerates, and the user tenant source enumerates `User` rows; an
 * orphaned lock is precisely a claim no live identifier backs, so a
 * per-tenant migration would never reach one.
 *
 * Its failure is never the pass's: the reap removes rows the pass did not
 * write, and a pass that reported nothing because a reap threw would hide the
 * migration outcome an operator asked for.
 */
async function reapOrphanedAddressLocks(): Promise<void> {
  try {
    await identityAddressLockReaper().runPass();
  } catch (error) {
    logger.warn(
      { error },
      "the address-lock reap failed; the locks stay and the next pass retries",
    );
  }
}
