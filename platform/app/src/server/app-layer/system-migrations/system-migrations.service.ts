import { createLogger } from "@langwatch/observability";
import type {
  MigrationPassSummary,
  TenantMigrationRecord,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";
import {
  MigrationEnrollmentCloudOnlyError,
  MigrationEnrollmentOrganizationNotFoundError,
  MigrationRollbackRequiresMigratedOrFinalizedError,
  MigrationStateNotFoundError,
} from "./errors";

/**
 * The statuses a tenant may be rolled back from. The same pair as
 * `LEDGER_WRITE_STATUSES` in ../authz/ledger-write-gate.ts, but the premise
 * is weaker than "already on the ledger": what `migrated` MEANS is each
 * migration's own business (the cutover parks tenants in `migrated` while
 * they merely WAIT on prerequisites or a cohort, and those never touched
 * the ledger at all). The status check here is therefore only the generic
 * floor - per-migration preconditions live in `rollbackGuards`, which is
 * where "this migrated tenant has nothing to roll back" and "another
 * migration still depends on this one" are refused. `parked` never did any
 * work worth undoing, and `rolled_back` is accepted only as a RETRY of a
 * standing pin.
 */
const ROLLBACK_ELIGIBLE_STATUSES: readonly TenantMigrationStatus[] = [
  "migrated",
  "finalized",
  // Not a rollback but a RETRY of one: the pin already stands and only the
  // effect re-fires. See `rollBack`.
  "rolled_back",
];

const logger = createLogger("langwatch:ops:system-migrations");

/**
 * The ops model over stored migration state. Deliberately narrower than the
 * runner's own port: the runner reads and writes one tenant at a time; the
 * dashboard reads across them, and its writes are the operator's levers -
 * the rollback (migrated or finalized → rolled_back, the state machine's
 * only human-driven edge) and, on cloud, the enrollment rows that pace who
 * migrates at all.
 */
/**
 * The two independently paced enrollment stages of the cloud rollout:
 * "migrations" is the preparation work (the team-user backfill and the
 * genesis import), "cutover" is the flip onto the engine. A plain string
 * vocabulary validated at the boundary, like the status column.
 */
export const MIGRATION_ENROLLMENT_STAGES = ["migrations", "cutover"] as const;

export type MigrationEnrollmentStage =
  (typeof MIGRATION_ENROLLMENT_STAGES)[number];

/** One enrollment row as the ops page lists it. */
export type MigrationEnrollmentRecord = {
  organizationId: string;
  /** Null when the organization has since been deleted. */
  organizationName: string | null;
  stage: MigrationEnrollmentStage;
  enrolledByUserId: string;
  /** The enroller's display name; null when it no longer resolves (the user
   *  id above still identifies them). Never the email - the name is the one
   *  piece of personal data the listing carries, and the read is audited
   *  for exactly that reason. */
  enrolledByLabel: string | null;
  createdAt: Date;
};

/**
 * The enrollment store the ops actions write through. Uniqueness refusals
 * (duplicate enroll, withdraw of nothing) are the store's - the unique key
 * is the only race-free check - and both surface as handled errors.
 */
export interface SystemMigrationEnrollmentStore {
  findAllByStage(args: {
    stage: MigrationEnrollmentStage;
  }): Promise<MigrationEnrollmentRecord[]>;
  findOrganizationById(args: {
    organizationId: string;
  }): Promise<{ id: string; name: string } | null>;
  create(args: {
    organizationId: string;
    stage: MigrationEnrollmentStage;
    enrolledByUserId: string;
  }): Promise<void>;
  delete(args: {
    organizationId: string;
    stage: MigrationEnrollmentStage;
  }): Promise<void>;
}

export interface SystemMigrationStateReader {
  findStatusCounts(args: {
    migrationName: string;
  }): Promise<Record<TenantMigrationStatus, number>>;

  findRecordsByStatus(args: {
    migrationName: string;
    statuses: TenantMigrationStatus[];
    limit: number;
  }): Promise<Array<TenantMigrationRecord & { updatedAt: Date }>>;

  findRecord(args: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null>;

  upsertRecord(record: TenantMigrationRecord): Promise<void>;
}

/** How many attention rows one migration lists before the page truncates. */
const ATTENTION_LIMIT = 50;

export type MigrationOverview = {
  name: string;
  /**
   * False only on self-hosted, for a migration whose
   * `runsAutomaticallyOnSelfHosted` declaration has not been released yet:
   * the runner never drives it here, so its empty counts are a normal
   * waiting state rather than something needing attention. Cloud runs every
   * registered migration, so this is always true there.
   */
  availableOnThisInstallation: boolean;
  counts: Record<TenantMigrationStatus, number>;
  attention: Array<TenantMigrationRecord & { updatedAt: Date }>;
};

/**
 * The ops dashboard's view of the in-place migrations, and the operator's one
 * lever over them. Routes call this and nothing else - the state repository
 * stays behind the app layer.
 */
export class SystemMigrationsService {
  constructor(
    private readonly deps: {
      state: SystemMigrationStateReader;
      /** Every registered migration's listing-facing declaration, cutover last. */
      migrations: () => Array<{
        name: string;
        runsAutomaticallyOnSelfHosted: boolean;
      }>;
      /** Read per call, so the answer is never a boot-time capture. */
      isSaaS: () => boolean;
      enrollments: SystemMigrationEnrollmentStore;
      /**
       * The ops audit trail. Enrollment decides which organizations the
       * platform migrates, so both actions are recorded the way the
       * backfill's own writes are - and the enrollment LISTING is recorded
       * too, because it returns the enrollers' display names (personal
       * data). A platform-scope entry carries no organizationId.
       */
      audit: (entry: {
        userId: string;
        organizationId?: string;
        action: string;
        args?: Record<string, unknown>;
      }) => Promise<void>;
      runPass: () => Promise<MigrationPassSummary | null>;
      /**
       * What else a rollback has to DO, per migration name. The generic
       * rollback is a state write; a migration whose finalization changed
       * how the running fleet behaves needs that change undone too, and
       * only the migration's own composition knows how (for the authz
       * cutover: the projection flipped off synchronously, the epoch bumped,
       * the gate cache dropped, a `cutover_rolled_back` fact appended).
       * Migrations with nothing to undo simply have no entry.
       *
       * An effect MUST be idempotent, because `rollBack` re-runs it on every
       * retry (see the method's own doc). `decidedAt` is what makes that
       * cheap: it is the moment the rollback was DECIDED (the pin's
       * timestamp), stable across every retry of that decision and fresh for
       * a later rollback of a re-cutover organization, so an effect can
       * derive a deduplicating id from it rather than from the clock.
       */
      rollbackEffects?: Record<
        string,
        (args: {
          tenantId: string;
          actorUserId: string;
          decidedAt: string;
        }) => Promise<void>
      >;
      /**
       * What must HOLD before a rollback may even be pinned, per migration
       * name. The generic service knows the state machine; it does not know
       * that one migration's state depends on another's, or that a status
       * can be technically eligible while there is nothing behind it to
       * undo - that is domain knowledge, and it lives in the composition
       * (runtime.ts) exactly like `rollbackEffects` does. A guard refuses
       * by throwing (a `HandledError` the operator can act on); it runs
       * BEFORE the pin is written, and on retries too - a refusal must hold
       * however the operator arrived here.
       */
      rollbackGuards?: Record<
        string,
        (args: {
          tenantId: string;
          record: TenantMigrationRecord;
        }) => Promise<void>
      >;
    },
  ) {}

  /**
   * Best-effort write to the ops audit trail. A write that already landed -
   * the enrollment row, the withdrawal, the listing read - must not turn
   * into a 500 for the operator because the trail itself failed to record;
   * the caller's retry would then hit the store's own uniqueness refusal for
   * an action that already happened. Same posture as
   * `GrantsLedgerWriter.recordLegacyAudit` in ../authz/ledger.ts.
   */
  private async recordAudit(entry: {
    userId: string;
    organizationId?: string;
    action: string;
    args?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.deps.audit(entry);
    } catch (err) {
      logger.warn(
        { err, action: entry.action, organizationId: entry.organizationId },
        "failed to record the audit row for a system migration action; the action itself landed",
      );
    }
  }

  /**
   * Per migration: the status rollup, plus the tenants needing attention -
   * held (`migrated`, parity disagreements in the report) and `parked`
   * (errored, retried next pass). Finalized tenants are a count, not a
   * listing, and neither are rolled-back ones.
   */
  async getOverview(): Promise<MigrationOverview[]> {
    const isSaaS = this.deps.isSaaS();
    return Promise.all(
      this.deps.migrations().map(async (migration) => ({
        name: migration.name,
        availableOnThisInstallation:
          isSaaS || migration.runsAutomaticallyOnSelfHosted,
        counts: await this.deps.state.findStatusCounts({
          migrationName: migration.name,
        }),
        attention: await this.deps.state.findRecordsByStatus({
          migrationName: migration.name,
          statuses: ["migrated", "parked"],
          limit: ATTENTION_LIMIT,
        }),
      })),
    );
  }

  /**
   * The enrollment listing for the ops page: both stages, newest first, with
   * whatever names still resolve. `isSaaS` rides along so the page can say
   * honestly that a self-hosted installation has nothing to enroll. The
   * read is audited because the records carry the enrollers' display names -
   * personal data leaves through here, so the trail says who read it.
   */
  async getEnrollments({ requestedBy }: { requestedBy: string }): Promise<{
    isSaaS: boolean;
    enrollments: MigrationEnrollmentRecord[];
  }> {
    const perStage = await Promise.all(
      MIGRATION_ENROLLMENT_STAGES.map((stage) =>
        this.deps.enrollments.findAllByStage({ stage }),
      ),
    );
    await this.recordAudit({
      userId: requestedBy,
      action: "systemMigrations.listEnrollments",
    });
    return { isSaaS: this.deps.isSaaS(), enrollments: perStage.flat() };
  }

  /**
   * Enroll one organization for one stage of the cloud rollout
   * (specs/rbac/in-place-authz-migration.feature, the enrollment scenarios).
   * Takes effect on the next pass - the runner reads enrollment fresh each
   * time - and refuses rather than lies: off cloud (where a row would change
   * nothing, see MigrationEnrollmentCloudOnlyError), for an organization
   * that does not exist, and for one already enrolled (the store's unique
   * key raises that refusal).
   */
  async enroll({
    organizationId,
    stage,
    actorUserId,
  }: {
    organizationId: string;
    stage: MigrationEnrollmentStage;
    actorUserId: string;
  }): Promise<void> {
    if (!this.deps.isSaaS()) throw new MigrationEnrollmentCloudOnlyError();
    const organization = await this.deps.enrollments.findOrganizationById({
      organizationId,
    });
    if (!organization) {
      throw new MigrationEnrollmentOrganizationNotFoundError();
    }
    await this.deps.enrollments.create({
      organizationId,
      stage,
      enrolledByUserId: actorUserId,
    });
    logger.info(
      { organizationId, stage, actorUserId },
      "operator enrolled an organization for the in-place migration rollout",
    );
    await this.recordAudit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.enroll",
      args: { stage },
    });
  }

  /**
   * Withdraw an enrollment: the row is deleted, and the next pass simply no
   * longer processes the organization for that stage. State already recorded
   * stays exactly as it is - withdrawal pauses the rollout, it does not roll
   * anything back (that is the operator rollback's job).
   */
  async withdraw({
    organizationId,
    stage,
    actorUserId,
  }: {
    organizationId: string;
    stage: MigrationEnrollmentStage;
    actorUserId: string;
  }): Promise<void> {
    if (!this.deps.isSaaS()) throw new MigrationEnrollmentCloudOnlyError();
    await this.deps.enrollments.delete({ organizationId, stage });
    logger.info(
      { organizationId, stage, actorUserId },
      "operator withdrew an organization from the in-place migration rollout",
    );
    await this.recordAudit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.withdraw",
      args: { stage },
    });
  }

  /**
   * Kick a pass now instead of waiting for the next worker boot - the lever
   * for processing a fresh enrollment right away or re-verifying held
   * tenants after remediation. Fire-and-forget: the fleet-wide lease already guarantees a
   * single driver, so the worst case for a double click is a pass that
   * stands down immediately.
   */
  startPass(): void {
    void this.deps.runPass().catch((error) => {
      // Per-tenant failures park-and-log inside the pass; this catches the
      // pass itself dying (state table or tenant source down). The next boot
      // retries either way.
      logger.error({ error }, "operator-kicked migration pass failed");
    });
  }

  /**
   * The operator's rollback: pin a migrated or finalized organization back
   * onto its legacy path (specs/rbac/in-place-authz-migration.feature, "An
   * operator rolls a finalized organization back to its legacy path", "An
   * operator rolls a migrated organization back to its legacy path"), then
   * apply whatever that migration's rollback has to DO.
   *
   * Three statuses are accepted, and the third is the whole point:
   *
   *   `migrated`     held on the ledger with parity still disagreeing —
   *   `finalized`    parity clean. Both are already live on ledger writes
   *                  (ledger-write-gate.ts), so both are the operator's to
   *                  pull back. The pin is written FIRST — the stored
   *                  `rolled_back` status is what stops the next pass
   *                  re-finalizing the tenant, so it must land even if the
   *                  effect cannot — and the effect runs after it.
   *   `rolled_back`  a RETRY of a rollback whose effect did not fully apply.
   *                  The pin already stands and is left exactly as it is
   *                  (including who decided and when); only the effect
   *                  re-fires. Without this an effect that threw halfway
   *                  stranded the organization: the status said rolled back,
   *                  the fleet still served it from the engine, and every
   *                  retry bounced off the eligibility refusal.
   *
   * Every other status either never reached the ledger or is the runner's to
   * move, and is refused.
   *
   * Because a retry re-runs the effect, effects must be idempotent. They are
   * handed `decidedAt` — the pin's own timestamp, unchanged across retries —
   * so an effect can key a deduplicating command id off the DECISION rather
   * than off the clock. A later rollback (after the organization was cut over
   * again) writes a new pin and therefore gets a new `decidedAt`, so it is a
   * distinct decision rather than a duplicate of the old one.
   *
   * The ledger-write gate always picks the change up within its cache window;
   * the legacy-fallback gate only mattered once the organization was
   * finalized, since that is the only status it treats specially. Later
   * passes leave the organization alone (rolled_back is terminal until an
   * operator intervenes again).
   */
  async rollBack({
    migrationName,
    tenantId,
    actorUserId,
  }: {
    migrationName: string;
    tenantId: string;
    actorUserId: string;
  }): Promise<void> {
    const record = await this.deps.state.findRecord({
      migrationName,
      tenantId,
    });
    if (!record) throw new MigrationStateNotFoundError();
    if (!ROLLBACK_ELIGIBLE_STATUSES.includes(record.status)) {
      throw new MigrationRollbackRequiresMigratedOrFinalizedError({
        status: record.status,
      });
    }
    // The migration's own preconditions, before anything is written: a
    // refusal here leaves no pin behind, so the tenant's state is exactly
    // what it was when the operator asked.
    await this.deps.rollbackGuards?.[migrationName]?.({ tenantId, record });
    const priorReport =
      record.report != null && typeof record.report === "object"
        ? (record.report as Record<string, unknown>)
        : {};
    // A fresh decision for an organization still on the ledger, the recorded
    // one for a retry. The status is what distinguishes them: a migrated or
    // finalized record that still carries a stamp from an earlier rollback
    // has since been cut over again, and rolling it back now is a NEW
    // decision that must not reuse the old moment (and so must not dedupe
    // against the old event).
    const decidedAt =
      (record.status === "rolled_back"
        ? rollbackDecidedAt(priorReport)
        : null) ?? new Date().toISOString();

    // The pin FIRST, its effects after — deliberately in that order. The
    // stored `rolled_back` status is what stops the next pass re-finalizing
    // the tenant, so it must land even if the effect cannot. An effect that
    // throws therefore leaves the pin standing and propagates to the
    // operator, who sees a rollback that was recorded but not fully applied
    // and can retry it; the reverse order could leave a tenant the runner
    // re-finalizes minutes later.
    if (record.status !== "rolled_back") {
      await this.deps.state.upsertRecord({
        ...record,
        status: "rolled_back",
        report: {
          ...priorReport,
          rolledBack: { by: actorUserId, at: decidedAt },
        },
      });
      logger.warn(
        { migrationName, tenantId, actorUserId, priorStatus: record.status },
        "operator rolled a migrated or finalized tenant back to its legacy path",
      );
    } else {
      // No second pin, and no second decision moment: this call exists to
      // finish the one already recorded. A standing pin with no stamp (the
      // pin predates the stamp, or its report write was lost) gets THIS
      // moment persisted onto it - otherwise every retry mints a fresh
      // decidedAt, and the effect's decidedAt-keyed dedupe treats each retry
      // as a new decision instead of finishing the recorded one.
      if (rollbackDecidedAt(priorReport) === null) {
        await this.deps.state.upsertRecord({
          ...record,
          status: "rolled_back",
          report: {
            ...priorReport,
            rolledBack: { by: actorUserId, at: decidedAt },
          },
        });
      }
      logger.warn(
        { migrationName, tenantId, actorUserId, decidedAt },
        "operator retried the rollback of an already pinned tenant",
      );
    }

    await this.deps.rollbackEffects?.[migrationName]?.({
      tenantId,
      actorUserId,
      decidedAt,
    });
  }
}

/**
 * When this rollback was decided, read back off the pin a previous call
 * wrote. Null when the report carries no usable stamp — a record pinned by
 * something other than this method, or by a version of it that predates the
 * stamp — in which case the caller falls back to now and the retry simply
 * does not dedupe.
 */
function rollbackDecidedAt(report: Record<string, unknown>): string | null {
  const rolledBack = report.rolledBack;
  if (rolledBack == null || typeof rolledBack !== "object") return null;
  const at = (rolledBack as Record<string, unknown>).at;
  return typeof at === "string" && at !== "" ? at : null;
}
