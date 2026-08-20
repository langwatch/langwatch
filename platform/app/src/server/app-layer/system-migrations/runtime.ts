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
  AuthzCollectorService,
  TEAM_USER_BACKFILL_MIGRATION_NAME,
} from "@langwatch/authz-server";
import {
  CUTOVER_WAITING_REPORT_KINDS,
  GRANTS_CUTOVER_MIGRATION_NAME,
  GRANTS_GENESIS_IMPORT_MIGRATION_NAME,
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
  type TenantMigrationRecord,
} from "@langwatch/system-migrations";
import type { Cluster, Redis } from "ioredis";
import { env } from "~/env.mjs";
import type { Prisma } from "~/generated/prisma/client";
import { getPrivateClickHouseUrls } from "../../clickhouse/clickhouseClient";
import { prisma } from "../../db";
import { tryGetApp } from "../app";
import {
  invalidateCutoverGate,
  queryCutoverOnEngine,
} from "../authz/cutover-gate";
import { bumpAuthzEpoch } from "../authz/epoch";
import { authzGrantsCommands } from "../authz/ledger";
import { SYSTEM_ACTORS } from "../authz/ledger-actor";
import { PrismaAuthzGrantsProjectionRepository } from "../authz/repositories/authz-grants-projection.prisma.repository";
import { PrismaAuthzMigrationRepository } from "../authz/repositories/authz-migration.prisma.repository";
import { GrantsAuthzReadRepository } from "../authz/repositories/authz-read.grants.repository";
import { PrismaAuthzReadRepository } from "../authz/repositories/authz-read.prisma.repository";
import { legacyOrganizationDecide } from "../authz/repositories/cutover-parity.legacy-decide";
import { authzCollector } from "../authz/runtime";
import {
  migrationRunsOnThisInstallation,
  organizationMigrates,
} from "./cohort";
import {
  MigrationRollbackBlockedByDependentError,
  MigrationRollbackCutoverNotStartedError,
} from "./errors";
import { RedisMigrationLeaseRepository } from "./repositories/migration-lease.redis.repository";
import { PrismaOrganizationTenantSource } from "./repositories/organization-tenant-source.prisma.repository";
import { PrismaSystemMigrationEnrollmentRepository } from "./repositories/system-migration-enrollment.prisma.repository";
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
 * The cloud rollout's enrollment rows: what the ops enrollment actions write
 * and what every pass reads fresh (see `runSystemMigrationPass` and the
 * cutover's `cutoverCohort` below).
 */
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
  // The cutover is the only migration that waits (on its prerequisites, or
  // on the cohort), and its report is the only place that says so - the
  // same fact the rollback guard below reads.
  waitingReports: {
    [GRANTS_CUTOVER_MIGRATION_NAME]: cutoverReportSaysWaiting,
  },
  rollbackEffects: {
    [GRANTS_CUTOVER_MIGRATION_NAME]: rollBackAuthzCutover,
  },
  // The authz knowledge the generic service must not carry: which
  // migrations the cutover stands on, and when a cutover rollback has
  // nothing behind it to undo. Guards run before the pin is written and on
  // retries, so a refusal holds however the operator arrived.
  rollbackGuards: {
    [TEAM_USER_BACKFILL_MIGRATION_NAME]: refuseWhileCutoverStandsOnIt,
    [GRANTS_GENESIS_IMPORT_MIGRATION_NAME]: refuseWhileCutoverStandsOnIt,
    [GRANTS_CUTOVER_MIGRATION_NAME]: refuseCutoverRollbackBeforeItStarted,
  },
});

/**
 * Whether a cutover record's report says the migration is merely WAITING -
 * on unfinished prerequisites, or outside the cohort. Waiting tenants sit in
 * `migrated` (the runner has no waiting status), but nothing was imported
 * and nothing flipped, so there is nothing on the ledger for a rollback to
 * concern itself with.
 */
function cutoverReportSaysWaiting(report: unknown): boolean {
  if (report == null || typeof report !== "object") return false;
  const kind = (report as Record<string, unknown>).kind;
  return (CUTOVER_WAITING_REPORT_KINDS as readonly unknown[]).includes(kind);
}

/**
 * The dependency guard (delivery-plan review L1): the genesis import and the
 * team-user backfill are the floor the authz cutover stands on, so neither
 * may be rolled back from under a cutover that is `migrated` or `finalized`.
 *
 * The failure mode this refuses is asymmetric access: the ledger-write gate
 * keys on the GENESIS status, so rolling the genesis back flips this
 * organization's grant WRITES onto the legacy path while its reads stay
 * wherever the cutover left them. A revocation then deletes the RoleBinding
 * row and never the Grant head - and the engine keeps honouring the head, so
 * the revoked member keeps access until somebody notices. The operator's
 * path is stated by the refusal: roll the cutover back first (which flips
 * reads AND is guarded below), then the floor.
 *
 * A cutover that is `migrated` but merely WAITING is exempt: it has stated
 * nothing on the ledger and flipped nothing, so nothing stands on the floor
 * yet - and refusing would deadlock, since the waiting cutover itself
 * refuses to roll back (see the guard below).
 */
async function refuseWhileCutoverStandsOnIt({
  tenantId,
}: {
  tenantId: string;
  record: TenantMigrationRecord;
}): Promise<void> {
  const cutover = await systemMigrationState.findRecord({
    migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
    tenantId,
  });
  if (!cutover) return;
  if (cutover.status !== "migrated" && cutover.status !== "finalized") return;
  if (cutoverReportSaysWaiting(cutover.report)) return;
  throw new MigrationRollbackBlockedByDependentError({
    blockingMigration: GRANTS_CUTOVER_MIGRATION_NAME,
    blockingStatus: cutover.status,
  });
}

/**
 * The never-started guard (delivery-plan review L5): a cutover record that
 * is `migrated` only because the organization is WAITING has no flip to
 * undo. Rolling it back would append a spurious `cutover_rolled_back` fact
 * and - worse - pin the row terminally `rolled_back`, stranding an
 * organization the runner would otherwise have cut over once its wait
 * ended. The projection is consulted too, in the fail-open direction: an
 * organization that IS on the engine is always the operator's to pull back,
 * whatever its report says - the lever exists for incidents, and a stale
 * report must never block it.
 */
async function refuseCutoverRollbackBeforeItStarted({
  tenantId,
  record,
}: {
  tenantId: string;
  record: TenantMigrationRecord;
}): Promise<void> {
  if (!cutoverReportSaysWaiting(record.report)) return;
  // The gate's own uncached query, so this guard and the request path can
  // never drift onto different predicates.
  const onEngine = await queryCutoverOnEngine({
    prisma,
    organizationId: tenantId,
  });
  if (onEngine) return;
  throw new MigrationRollbackCutoverNotStartedError();
}

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
export async function rollBackAuthzCutover({
  tenantId,
  actorUserId,
  decidedAt,
  sendFact = sendCutoverRollbackFact,
}: {
  tenantId: string;
  actorUserId: string;
  decidedAt: string;
  /**
   * The ledger append alone, injectable so the rollback suite can sever the
   * queue leg while running THIS function - a copy of the steps drifted
   * once (it lost the gate invalidation) and a copy can always drift again.
   * Production never passes it: the default is the real command bus, bound
   * right here.
   */
  sendFact?: CutoverRollbackFactSender;
}): Promise<void> {
  const organizationId = tenantId;
  const projectionRepository = new PrismaAuthzGrantsProjectionRepository(
    prisma,
  );
  await projectionRepository.enforceCutoverRollback({ organizationId });
  invalidateCutoverGate({ organizationId });
  await bumpAuthzEpoch({ organizationId });

  const decidedAtMs = Date.parse(decidedAt);
  try {
    // The fact must land AFTER the completion it undoes, on the ledger's own
    // clock. `decidedAt` is this web pod's clock; the reducer's monotonic
    // guard compares against the completion's `occurredAtMs`, stamped by a
    // WORKER - and with cross-pod skew a rollback stamped behind the
    // completion is silently dropped at fold, permanently (the retry reuses
    // the same command id, so a corrected stamp never lands). So the stamp
    // is max(decidedAt, the projection's changedAt + 1): `changedAt` is the
    // newest cutover fact's business time, persisted by the fold, and the
    // enforcement write above deliberately leaves it untouched. The command
    // id stays keyed on `decidedAt` alone, so retries of one decision still
    // dedupe.
    const changedAtMs = await projectionRepository.findCutoverChangedAtMs({
      organizationId,
    });
    const flooredAtMs = Number.isFinite(decidedAtMs) ? decidedAtMs : Date.now();
    await sendFact({
      organizationId,
      actorUserId,
      commandId: `cutover:rollback:${organizationId}:${decidedAt}`,
      occurredAtMs:
        changedAtMs === null
          ? flooredAtMs
          : Math.max(flooredAtMs, changedAtMs + 1),
    });
  } catch (error) {
    logger.error(
      { error, organizationId, actorUserId, decidedAt },
      "cutover rollback enforced but its ledger fact was not appended - the organization IS off the engine; replay will not show why",
    );
  }
}

type CutoverRollbackFactSender = (args: {
  organizationId: string;
  actorUserId: string;
  commandId: string;
  occurredAtMs: number;
}) => Promise<void>;

const sendCutoverRollbackFact: CutoverRollbackFactSender = async ({
  organizationId,
  actorUserId,
  commandId,
  occurredAtMs,
}) => {
  await (await authzGrantsCommands()).commands.rollBackCutover.send({
    tenantId: organizationId,
    organizationId,
    commandId,
    actor: { type: "user", id: actorUserId },
    reason: "operator rollback",
    occurredAtMs,
  });
};

/**
 * The genesis import's compensating half, split out because it IS a separate
 * job: every other verb here states a grant that exists, these two state one
 * that stopped existing — a head grant whose legacy row is gone, and a stale
 * custom role. Nothing but the genesis import emits them.
 */
function genesisDenyDirectionEmitter(): Pick<
  GrantsLedgerEmitter,
  "revokeGrants" | "deleteRole"
> {
  return {
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
  };
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
    ...genesisDenyDirectionEmitter(),
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
      // The cutover's own belt-and-braces enrollment probe, on top of the
      // runner's per-migration cohort: the backfill and the genesis import
      // are dark and can go wide, while the cutover is the one migration
      // that changes who decides, so it advances organization by
      // organization - on cloud, only when an operator enrolled the
      // organization for it, read from the database per call so a new
      // enrollment needs no restart. Self-hosted
      // cuts over automatically once its prerequisites finalize - the
      // in-place doctrine (an operator never learns it happened), and what
      // makes that safe is the parity proof standing between the import and
      // the flip. That arm engages only once the cutover's own
      // `runsAutomaticallyOnSelfHosted` declaration is released: until then
      // the self-hosted runner never drives this migration at all (see
      // `runSystemMigrationPass`), so answering true here is the released
      // behavior, not a bypass.
      cutoverCohort: (tenantId) => cutoverEnrollmentCohort(tenantId),
      now: () => Date.now(),
    }),
  ];
}

/**
 * Whether one organization may cut over on THIS pass of THIS installation:
 * its "cutover" enrollment on cloud (a per-call database read, so enrolling
 * needs no restart), automatic self-hosted - where reaching this question at
 * all means the cutover's release declaration admitted the migration (see
 * the cutoverCohort comment in `registeredMigrations`).
 */
export async function cutoverEnrollmentCohort(
  tenantId: string,
): Promise<boolean> {
  if (env.IS_SAAS !== true) return true;
  return enrollmentRepository.isEnrolled({
    organizationId: tenantId,
    migrationName: GRANTS_CUTOVER_MIGRATION_NAME,
  });
}

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
 * The same lease as a full pass (one driver fleet-wide, so a targeted run
 * can never double-drive an organization a pass is working through; null
 * means the lease is held and the service turns that into a retry-shaped
 * refusal), the same cohort read (enrollment stays the pacing source of
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
