import { createLogger } from "@langwatch/observability";
import type {
  MigrationPassSummary,
  TenantMigrationRecord,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";
import {
  MigrationDrainProofRequiresMigratedError,
  MigrationEnrolledAutomaticallyError,
  MigrationEnrollmentCloudOnlyError,
  MigrationEnrollmentOrganizationNotFoundError,
  MigrationNotAvailableOnInstallationError,
  MigrationPassAlreadyRunningError,
  MigrationRunRequiresEnrollmentError,
  MigrationStateNotFoundError,
  MigrationUnknownError,
} from "./errors";

/**
 * The statuses a tenant may be rolled back from. The same pair as
 * the AuthZ package's cutover adapter, but the premise
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
const ROLLBACK_EFFECT_STATUSES: readonly TenantMigrationStatus[] = [
  "migrated",
  "finalized",
  "rolled_back",
];

const logger = createLogger("langwatch:ops:system-migrations");

/**
 * The ops model over stored migration state. Deliberately narrower than the
 * runner's own port: the runner reads and writes one tenant at a time; the
 * dashboard reads across them, and its writes are the operator's levers -
 * the rollback (migrated or finalized → rolled_back, the state machine's
 * only human-driven edge) and, on cloud, the enrollment rows that pace the
 * migrations still asking to be paced.
 */
/** One enrollment row as the ops page lists it. */
export type MigrationEnrollmentRecord = {
  organizationId: string;
  /** Null when the organization has since been deleted. */
  organizationName: string | null;
  /** The stable name of the migration this row enrolls the organization in. */
  migrationName: string;
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
  findAll(): Promise<MigrationEnrollmentRecord[]>;
  findOrganizationById(args: {
    organizationId: string;
  }): Promise<{ id: string; name: string } | null>;
  isEnrolled(args: { organizationId: string; migrationName: string }): Promise<boolean>;
  countEnrolledByMigration(): Promise<Map<string, number>>;
  countOrganizations(): Promise<number>;
  searchOrganizations(args: {
    query: string;
  }): Promise<Array<{ id: string; name: string }>>;
  create(args: {
    organizationId: string;
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<void>;
  findCohortEligibleOrganizations(args: {
    migrationName: string;
    /** When set, the pool is restricted to organizations already enrolled
     *  for this migration - a later step samples the step before it. */
    enrolledForMigrationName?: string;
    excludeOrganizationIds: string[];
    /** Lift the enterprise-subscription exclusion for this draw. Defaults to
     *  false at the repository, so a caller that says nothing gets the safe
     *  pool rather than the wide one. */
    includeEnterprise?: boolean;
  }): Promise<Array<{ id: string; name: string }>>;
  createMany(args: {
    organizationIds: string[];
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<{ insertedCount: number }>;
  delete(args: { organizationId: string; migrationName: string }): Promise<void>;
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
  /** The name operators read; presentation over the stable `name`. */
  title: string;
  /** What the migration does for an organization, in the operator's language. */
  description: string;
  /**
   * Whether acting on this migration takes the typed destructive
   * confirmation, so the page asks for it exactly where the server requires
   * it rather than deciding for itself which migration is dangerous.
   */
  requiresOperatorConfirmation: boolean;
  /**
   * False only on self-hosted, for a migration whose
   * `runsAutomaticallyOnSelfHosted` declaration has not been released yet:
   * the runner never drives it here, so its empty counts are a normal
   * waiting state rather than something needing attention. Cloud runs every
   * registered migration, so this is always true there.
   */
  availableOnThisInstallation: boolean;
  /**
   * Whether every organization is in this migration's cohort with no
   * operator action. The page says so instead of offering enrollment it
   * would be lying about.
   */
  enrolledAutomatically: boolean;
  counts: Record<TenantMigrationStatus, number>;
  /**
   * The rollout gauge: how many organizations are enrolled for this
   * migration, and how many are not. Null when there is nothing to enroll -
   * off cloud, where enrollment does not exist, and for a migration that
   * admits every organization automatically, where the count would describe
   * rows that decide nothing. Enrollment only - an organization counts as
   * not enrolled whether or not its prerequisites have finalized, because
   * enrolling early is legitimate (the migration waits), so this must never
   * be read as "ready to run".
   */
  enrollment: { enrolledCount: number; notEnrolledCount: number } | null;
  attention: Array<TenantMigrationRecord & { updatedAt: Date }>;
};

/**
 * A uniform sample without replacement: Fisher-Yates over a copy, first
 * `count` entries. A pool smaller than the ask returns the whole pool -
 * the caller reports how many it got rather than erroring.
 */
function sample<T>({ pool, count }: { pool: T[]; count: number }): T[] {
  const copy = [...pool];
  const size = Math.min(count, copy.length);
  for (let index = 0; index < size; index++) {
    const swap = index + Math.floor(Math.random() * (copy.length - index));
    [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
  }
  return copy.slice(0, size);
}

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
        title: string;
        description: string;
        requiresOperatorConfirmation: boolean;
        runsAutomaticallyOnSelfHosted: boolean;
        /**
         * Whether cloud puts every organization in this migration's cohort
         * with no enrollment row. The enrollment actions refuse for such a
         * migration rather than writing rows nothing reads.
         */
        enrolledAutomatically: boolean;
        /**
         * Which axis the runner drives this migration over. Organization
         * migrations form the ordered per-organization pipeline; a user
         * migration (ADR-101 §6) is paced by the same organization
         * enrollment but its tenants are the organization's MEMBERS, so it
         * is neither a step in that pipeline nor readable back by
         * organization id. Omitted means organization.
         */
        tenant?: "organization" | "user";
      }>;
      /** Read per call, so the answer is never a boot-time capture. */
      isSaaS: () => boolean;
      enrollments: SystemMigrationEnrollmentStore;
      /**
       * The organizations whose data plane is a private ClickHouse instance,
       * read from the environment's routing table. A cohort must never sweep
       * one up, and the environment - not a list in code - is what names
       * them.
       */
      privateDataplaneOrganizationIds: () => string[];
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
      runPass: () => Promise<MigrationPassSummary>;
      /**
       * One migration for one organization, now, under the same
       * per-organization claim as a full pass (the summary's `claimed`
       * says another pass is already working the organization). The
       * composition supplies it because only the composition can build a
       * runner scoped to a single (tenant, migration) pair.
       */
      runTargetedPass: (args: {
        organizationId: string;
        migrationName: string;
      }) => Promise<MigrationPassSummary>;
      /**
       * Whether a migration's stored report means it merely WAITED, per
       * migration name. The state machine has no waiting status, so a
       * migration that is waiting on something records `migrated` exactly
       * as a held one does, and only the migration's own composition can
       * tell the two apart by reading its report - so the predicate lives
       * there, like `rollbackGuards`. A migration that never waits has no
       * entry, and its `migrated` always means held.
       */
      waitingReports?: Record<string, (report: unknown) => boolean>;
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
          /** Null when nothing has run for this tenant yet - the operator is
           *  pinning it OUT of a rollout ahead of the pass, and a guard that
           *  needs a record has to say so itself rather than assume one. */
          record: TenantMigrationRecord | null;
        }) => Promise<void>
      >;
    },
  ) {}

  /**
   * Per migration: the status rollup, plus the tenants needing attention -
   * held (`migrated`, parity disagreements in the report) and `parked`
   * (errored, retried next pass). Finalized tenants are a count, not a
   * listing, and neither are rolled-back ones.
   */
  async getOverview(): Promise<MigrationOverview[]> {
    const isSaaS = this.deps.isSaaS();
    // One pair of queries for every migration's gauge, not a pair per
    // migration: the page polls this.
    const [enrolledByMigration, totalOrganizations] = isSaaS
      ? await Promise.all([
          this.deps.enrollments.countEnrolledByMigration(),
          this.deps.enrollments.countOrganizations(),
        ])
      : [null, 0];
    return Promise.all(
      this.deps.migrations().map(async (migration) => {
        const enrolledCount = enrolledByMigration?.get(migration.name) ?? 0;
        // Together, not one after the other: the page polls this, and the
        // rollup does not feed the listing.
        const [counts, attention] = await Promise.all([
          this.deps.state.findStatusCounts({ migrationName: migration.name }),
          this.deps.state.findRecordsByStatus({
            migrationName: migration.name,
            statuses: ["migrated", "parked"],
            limit: ATTENTION_LIMIT,
          }),
        ]);
        return {
          name: migration.name,
          title: migration.title,
          description: migration.description,
          requiresOperatorConfirmation: migration.requiresOperatorConfirmation,
          availableOnThisInstallation: isSaaS || migration.runsAutomaticallyOnSelfHosted,
          enrolledAutomatically: migration.enrolledAutomatically,
          counts,
          // Null for a migration that admits every organization automatically:
          // the gauge would describe rows that decide nothing. That is what
          // `MigrationOverview.enrollment` documents, and the guard was lost in
          // the same merge that dropped D04 — leaving the code contradicting
          // its own type's doc comment, with the test that pinned it gone too.
          enrollment:
            enrolledByMigration && !migration.enrolledAutomatically
              ? {
                  enrolledCount,
                  notEnrolledCount: Math.max(0, totalOrganizations - enrolledCount),
                }
              : null,
          attention,
        };
      }),
    );
  }

  /**
   * The enrollment listing for the ops page: every migration's, newest
   * first, with whatever names still resolve. `isSaaS` rides along so the
   * page can say honestly that a self-hosted installation has nothing to
   * enroll. The read is audited because the records carry the enrollers'
   * display names - personal data leaves through here, so the trail says
   * who read it.
   */
  async getEnrollments({ requestedBy }: { requestedBy: string }): Promise<{
    isSaaS: boolean;
    enrollments: MigrationEnrollmentRecord[];
  }> {
    const enrollments = await this.deps.enrollments.findAll();
    await this.deps.audit({
      userId: requestedBy,
      action: "systemMigrations.listEnrollments",
    });
    return { isSaaS: this.deps.isSaaS(), enrollments };
  }

  /**
   * The operator's organization lookup for the page's pickers - enroll,
   * targeted run and rollback all act on an organization the operator found
   * by name rather than by pasting an id.
   */
  async searchOrganizations({
    query,
  }: {
    query: string;
  }): Promise<Array<{ id: string; name: string }>> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    return this.deps.enrollments.searchOrganizations({ query: trimmed });
  }

  /**
   * Enroll one organization for one registered migration
   * (specs/migration/system-migrations-runner.feature, the enrollment scenarios).
   * Takes effect on the next pass - the runner reads enrollment fresh each
   * time - and refuses rather than lies: off cloud (where a row would change
   * nothing, see MigrationEnrollmentCloudOnlyError), for a migration that
   * admits every organization already (`enrolledAutomatically`), for a
   * migration nothing registered answers to, for an organization that does
   * not exist, and for one already enrolled (the store's unique key raises
   * that refusal).
   */
  async enroll({
    organizationId,
    migrationName,
    actorUserId,
  }: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void> {
    if (!this.deps.isSaaS()) throw new MigrationEnrollmentCloudOnlyError();
    this.requireRegisteredMigration(migrationName);
    this.requireEnrollmentDecidesSomething(migrationName);
    const organization = await this.deps.enrollments.findOrganizationById({
      organizationId,
    });
    if (!organization) {
      throw new MigrationEnrollmentOrganizationNotFoundError();
    }
    await this.deps.enrollments.create({
      organizationId,
      migrationName,
      enrolledByUserId: actorUserId,
    });
    logger.info(
      { organizationId, migrationName, actorUserId },
      "operator enrolled an organization for the in-place migration rollout",
    );
    await this.deps.audit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.enroll",
      args: { migrationName },
    });
  }

  /**
   * Enroll a sampled cohort for one migration in a single action
   * (specs/migration/system-migrations-runner.feature, the cohort scenarios).
   * The pool is every organization not yet enrolled for the migration,
   * minus the ones the platform already knows to leave alone by data
   * rather than by a hand-kept list: an active enterprise subscription, or
   * a private ClickHouse route in the environment. The sample is drawn at
   * random so a cohort is a spread of the long tail, not the same head of
   * some fixed order every time - and the result names every organization
   * it picked, because an action over N organizations is only auditable if
   * it says which N.
   *
   * Both exclusions are DEFAULTS, not laws. They exist so an experimental
   * cohort cannot sweep up the organizations we would least like to
   * surprise; once a migration has proven itself across the long tail,
   * finishing the rollout means taking those two classes over too, and an
   * operator who has decided that should not have to enroll them one id at
   * a time (the single-organization `enroll` never applied either
   * exclusion). Each is lifted SEPARATELY and named in the audit trail:
   * they carry different risks - an enterprise organization is a
   * commercial one, a private-dataplane organization has its events in a
   * ClickHouse instance of its own - and one checkbox for both would hide
   * that.
   */
  async enrollCohort({
    migrationName,
    sampleSize,
    actorUserId,
    includeEnterprise = false,
    includePrivateDataplane = false,
  }: {
    migrationName: string;
    sampleSize: number;
    actorUserId: string;
    /** Draw organizations with an active or pending ENTERPRISE subscription. */
    includeEnterprise?: boolean;
    /** Draw organizations whose events live in their own ClickHouse instance. */
    includePrivateDataplane?: boolean;
  }): Promise<{
    enrolled: Array<{ id: string; name: string }>;
    eligibleCount: number;
  }> {
    if (!this.deps.isSaaS()) throw new MigrationEnrollmentCloudOnlyError();
    this.requireRegisteredMigration(migrationName);
    this.requireEnrollmentDecidesSomething(migrationName);
    // The steps run as an ordered pipeline per organization, so a later
    // step's pool is the step before it: an organization enrolled for a
    // step whose predecessor nothing will ever run would sit pending
    // forever. The first step keeps sampling the whole installation.
    const ordered = this.deps.migrations();
    const index = ordered.findIndex((migration) => migration.name === migrationName);
    const previous = index > 0 ? ordered[index - 1] : undefined;
    const eligible = await this.deps.enrollments.findCohortEligibleOrganizations({
      migrationName,
      enrolledForMigrationName: previous?.name,
      excludeOrganizationIds: this.deps.privateDataplaneOrganizationIds(),
    });
    const picked = sample({ pool: eligible, count: sampleSize });
    const { insertedCount } = await this.deps.enrollments.createMany({
      organizationIds: picked.map((organization) => organization.id),
      migrationName,
      enrolledByUserId: actorUserId,
    });
    logger.info(
      {
        migrationName,
        actorUserId,
        sampleSize,
        // Both counts on purpose: `skipDuplicates` drops a row a concurrent
        // single enrollment already wrote, and the trail must not overclaim.
        pickedCount: picked.length,
        insertedCount,
        eligibleCount: eligible.length,
        // Which exclusions this cohort lifted, so a widened pool is legible
        // in the log rather than inferred from an unusually large sample.
        includeEnterprise,
        includePrivateDataplane,
        organizationIds: picked.map((organization) => organization.id),
      },
      "operator enrolled a cohort for the in-place migration rollout",
    );
    // One audit row PER organization, mirroring `enroll`'s shape: the row's
    // indexed organizationId column is how "what touched org X" is answered,
    // and a single row holding a thousand-id array loses every id to the
    // audit writer's size cap.
    for (const organization of picked) {
      await this.deps.audit({
        userId: actorUserId,
        organizationId: organization.id,
        action: "systemMigrations.enrollCohort",
        args: {
          migrationName,
          sampleSize,
          cohortSize: picked.length,
          // On the row itself, not only in the log: "was this organization
          // drawn because an operator lifted an exclusion?" is a question
          // asked of one organization, and the audit trail is where it is
          // answered.
          includeEnterprise,
          includePrivateDataplane,
        },
      });
    }
    return { enrolled: picked, eligibleCount: eligible.length };
  }

  /**
   * Withdraw an enrollment: the row is deleted, and the next pass simply no
   * longer processes the organization for that migration. State already
   * recorded stays exactly as it is - withdrawal pauses the rollout, it does
   * not roll anything back (that is the operator rollback's job). Refused
   * for a migration that admits every organization anyway, where deleting a
   * row would pause nothing.
   */
  async withdraw({
    organizationId,
    migrationName,
    actorUserId,
  }: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<void> {
    if (!this.deps.isSaaS()) throw new MigrationEnrollmentCloudOnlyError();
    this.requireEnrollmentDecidesSomething(migrationName);
    await this.deps.enrollments.delete({ organizationId, migrationName });
    logger.info(
      { organizationId, migrationName, actorUserId },
      "operator withdrew an organization from the in-place migration rollout",
    );
    await this.deps.audit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.withdraw",
      args: { migrationName },
    });
  }

  /**
   * Run one migration for one organization now
   * (specs/migration/system-migrations-runner.feature, "An operator runs one
   * migration for one organization now"). Awaited rather than
   * fire-and-forget - the operator asked about one organization and wants
   * its outcome. The cohort stays the source of truth on cloud: an
   * organization outside it is refused, never quietly migrated - though for
   * a migration that admits everyone the run only brings this organization's
   * turn forward. The organization's own claim still applies, so a run while
   * another pass is working that organization is refused with a retry-shaped
   * error instead of double-driving it.
   */
  async runForOrganization({
    organizationId,
    migrationName,
    actorUserId,
  }: {
    organizationId: string;
    migrationName: string;
    actorUserId: string;
  }): Promise<{ status: TenantMigrationStatus | null; waiting: boolean }> {
    const migration = this.requireRegisteredMigration(migrationName);
    await this.requireRunnableForOrganization({
      migration,
      organizationId,
      migrationName,
    });
    await this.deps.audit({
      userId: actorUserId,
      organizationId,
      action: "systemMigrations.runForOrganization",
      args: { migrationName },
    });
    const summary = await this.deps.runTargetedPass({
      organizationId,
      migrationName,
    });
    // Every tenant the run covered was claimed elsewhere, so this run did
    // nothing and the operator should retry. For an organization-rooted run
    // that is one tenant, so `claimed > 0` and this condition are the same
    // thing. For a USER-rooted run the tenants are the organization's
    // members, and one contended member is partial progress: aborting on it
    // would discard the outcomes of every member that finalized, and the
    // operator would be told to retry a run that mostly succeeded.
    if (summary.claimed > 0 && summary.claimed === summary.tenantsSeen) {
      throw new MigrationPassAlreadyRunningError();
    }
    if ((migration.tenant ?? "organization") === "user") {
      // The tenants were the organization's members, so there is no single
      // record to read back: the pass summary is the answer. Any held,
      // parked or still-contended member keeps the organization on the
      // operator's list.
      return { status: statusOfMemberSummary(summary), waiting: false };
    }
    return this.organizationRecordStatus({ migrationName, organizationId });
  }

  private async requireRunnableForOrganization({
    migration,
    organizationId,
    migrationName,
  }: {
    migration: {
      runsAutomaticallyOnSelfHosted: boolean;
      enrolledAutomatically: boolean;
    };
    organizationId: string;
    migrationName: string;
  }): Promise<void> {
    if (!this.deps.isSaaS() && !migration.runsAutomaticallyOnSelfHosted) {
      throw new MigrationNotAvailableOnInstallationError();
    }
    const organization = await this.deps.enrollments.findOrganizationById({
      organizationId,
    });
    if (!organization) {
      throw new MigrationEnrollmentOrganizationNotFoundError();
    }
    if (!this.deps.isSaaS()) return;
    // Nothing to be outside of: the migration admits every organization, so
    // a targeted run only brings this one's turn forward.
    if (migration.enrolledAutomatically) return;
    const enrolled = await this.deps.enrollments.isEnrolled({
      organizationId,
      migrationName,
    });
    if (!enrolled) {
      throw new MigrationRunRequiresEnrollmentError({ migrationName });
    }
  }

  private async organizationRecordStatus({
    migrationName,
    organizationId,
  }: {
    migrationName: string;
    organizationId: string;
  }): Promise<{ status: TenantMigrationStatus | null; waiting: boolean }> {
    const record = await this.deps.state.findRecord({
      migrationName,
      tenantId: organizationId,
    });
    // `migrated` covers two outcomes an operator must not confuse: the
    // migration ran and is held for review, or it did nothing because it is
    // still waiting. Only the migration's own report tells them apart, so
    // the status alone would report a waiting cutover as a held one.
    return {
      status: record?.status ?? null,
      waiting:
        record != null &&
        (this.deps.waitingReports?.[migrationName]?.(record.report) ?? false),
    };
  }

  /**
   * Whether acting on this migration takes the typed destructive
   * confirmation. Read from the migration's own declaration so the gate and
   * the page that renders it can never disagree about which migration is
   * dangerous; an unknown name is refused before any confirmation question
   * arises.
   */
  requiresOperatorConfirmation({ migrationName }: { migrationName: string }): boolean {
    return this.requireRegisteredMigration(migrationName).requiresOperatorConfirmation;
  }

  /** The migration a name refers to, or the refusal the operator can act on. */
  private requireRegisteredMigration(
    migrationName: string,
  ): ReturnType<SystemMigrationsService["deps"]["migrations"]>[number] {
    const migration = this.deps
      .migrations()
      .find((candidate) => candidate.name === migrationName);
    if (!migration) throw new MigrationUnknownError();
    return migration;
  }

  /**
   * The `rolled_back` pin, written unless a retry already carries it.
   *
   * A retry writes no second pin and mints no second decision moment: it
   * exists to finish the one already recorded. A standing pin with NO stamp
   * (it predates the stamp, or its report write was lost) does get this
   * moment persisted onto it - otherwise every retry mints a fresh
   * `decidedAt`, and an effect's decidedAt-keyed dedupe treats each retry as
   * a new decision instead of finishing the recorded one.
   */
  private async writePin({
    pin,
    record,
    isRetry,
    priorReport,
    actorUserId,
  }: {
    pin: TenantMigrationRecord;
    record: TenantMigrationRecord | null;
    isRetry: boolean;
    priorReport: Record<string, unknown>;
    actorUserId: string;
  }): Promise<void> {
    if (isRetry) {
      if (rollbackDecidedAt(priorReport) === null) {
        await this.deps.state.upsertRecord(pin);
      }
      logger.warn(
        {
          migrationName: pin.migrationName,
          tenantId: pin.tenantId,
          actorUserId,
        },
        "operator retried the rollback of an already pinned tenant",
      );
      return;
    }
    await this.deps.state.upsertRecord(pin);
    logger.warn(
      {
        migrationName: pin.migrationName,
        tenantId: pin.tenantId,
        actorUserId,
        // Null when nothing had run for this organization yet: the operator is
        // holding it OUT of a rollout rather than pulling it back from one,
        // and the trail must not read as the latter.
        priorStatus: record?.status ?? null,
      },
      "operator pinned a tenant onto its legacy path; later passes leave it alone",
    );
  }

  /**
   * Refuses an enrollment action on a migration that admits every
   * organization anyway. Withdrawal asks this too: pausing a rollout is what
   * an operator withdraws FOR, and a migration outside enrollment's reach
   * cannot be paused that way - the per-organization rollback is the lever
   * that still works on it.
   *
   * An unregistered name passes here and is refused by
   * `requireRegisteredMigration` where the caller checks it, so this guard
   * never turns "unknown migration" into the wrong refusal.
   */
  private requireEnrollmentDecidesSomething(migrationName: string): void {
    const migration = this.deps
      .migrations()
      .find((candidate) => candidate.name === migrationName);
    if (migration?.enrolledAutomatically) {
      throw new MigrationEnrolledAutomaticallyError({ migrationName });
    }
  }

  /**
   * Kick a pass now instead of waiting for the next worker boot - the lever
   * for processing a fresh enrollment right away or re-verifying held
   * tenants after remediation. Fire-and-forget: per-organization claims keep
   * two passes off the same organization, so the worst case for a double
   * click is a pass that finds everything claimed and does nothing.
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
   * Records the deployment fact that no legacy-only Stored Objects writer can
   * create bytes after reconciliation. The proof lives in the existing
   * migration report, not in another domain table.
   */
  async assertLegacyWritersDrained({
    migrationName,
    tenantId,
    minimumWriterGeneration,
    actorUserId,
  }: {
    migrationName: string;
    tenantId: string;
    minimumWriterGeneration: string;
    actorUserId: string;
  }): Promise<void> {
    const record = await this.deps.state.findRecord({
      migrationName,
      tenantId,
    });
    if (!record) throw new MigrationStateNotFoundError();
    if (record.status !== "migrated") {
      throw new MigrationDrainProofRequiresMigratedError({
        status: record.status,
      });
    }
    const priorReport =
      record.report != null && typeof record.report === "object"
        ? (record.report as Record<string, unknown>)
        : {};
    const assertedAt = new Date().toISOString();
    await this.deps.state.upsertRecord({
      ...record,
      report: {
        ...priorReport,
        legacyWriterDrainProof: {
          minimumWriterGeneration,
          assertedAt,
          actorUserId,
        },
      },
    });
    logger.warn(
      {
        migrationName,
        tenantId,
        minimumWriterGeneration,
        actorUserId,
        assertedAt,
      },
      "operator asserted that legacy-only writers are drained",
    );
  }

  /**
   * The operator's rollback: pin a migrated or finalized organization back
   * onto its legacy path (specs/migration/system-migrations-runner.feature, "An
   * operator rolls a finalized organization back to its legacy path", "An
   * operator rolls a migrated organization back to its legacy path"), then
   * apply whatever that migration's rollback has to DO.
   *
   * The pin is the lever, and it is the ONLY runtime lever: a migration that
   * enrols automatically has no enrollment to withdraw, so this is how an
   * operator takes one organization out of a rollout without a deploy. It
   * therefore accepts every status, and no record at all:
   *
   *   `migrated`     held on the ledger with parity still disagreeing —
   *   `finalized`    parity clean. Both may be live on ledger writes
   *                  (engine-gate.ts), so both are the operator's to pull
   *                  back, effect and all.
   *   `rolled_back`  a RETRY of a rollback whose effect did not fully apply.
   *                  The pin already stands and is left exactly as it is
   *                  (including who decided and when); only the effect
   *                  re-fires. Without this an effect that threw halfway
   *                  stranded the organization: the status said rolled back,
   *                  the fleet still served it from the engine, and every
   *                  retry bounced off an eligibility refusal.
   *   `parked`       erroring every pass. This is the case a status gate got
   *                  WRONG: an organization whose migration throws — its
   *                  ledger unreachable, its data plane down — is precisely
   *                  the one an operator needs to stop, and the convergence
   *                  loop now re-drives it up to `MAX_PASSES` times per boot
   *                  until they can.
   *   no record      never attempted, or not reached yet. Pinning ahead of
   *                  the pass is how an organization is held out of a
   *                  rollout that would otherwise reach it automatically.
   *
   * The pin is written FIRST in every case — the stored `rolled_back` status
   * is what stops the next pass, so it must land even if an effect cannot —
   * and the effect runs after it, for the statuses that could have reached
   * the ledger (`ROLLBACK_EFFECT_STATUSES`). A `parked` organization and one
   * with no record get the pin alone: there is no cutover to undo, and an
   * effect written for a tenant that cut over has no defined meaning against
   * one that never did.
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
    this.requireRegisteredMigration(migrationName);
    const record = await this.deps.state.findRecord({
      migrationName,
      tenantId,
    });
    // The migration's own preconditions, before anything is written: a
    // refusal here leaves no pin behind, so the tenant's state is exactly
    // what it was when the operator asked.
    await this.deps.rollbackGuards?.[migrationName]?.({ tenantId, record });
    const priorReport =
      record?.report != null && typeof record.report === "object"
        ? (record.report as Record<string, unknown>)
        : {};
    // A fresh decision for an organization still on the ledger, the recorded
    // one for a retry. The status is what distinguishes them: a migrated or
    // finalized record that still carries a stamp from an earlier rollback
    // has since been cut over again, and rolling it back now is a NEW
    // decision that must not reuse the old moment (and so must not dedupe
    // against the old event).
    const isRetry = record?.status === "rolled_back";
    const decidedAt =
      (isRetry ? rollbackDecidedAt(priorReport) : null) ?? new Date().toISOString();
    const pin = {
      migrationName,
      tenantId,
      status: "rolled_back" as const,
      report: {
        ...priorReport,
        rolledBack: { by: actorUserId, at: decidedAt },
      },
    };

    // The pin FIRST, its effects after — deliberately in that order. The
    // stored `rolled_back` status is what stops the next pass re-finalizing
    // the tenant, so it must land even if the effect cannot. An effect that
    // throws therefore leaves the pin standing and propagates to the
    // operator, who sees a rollback that was recorded but not fully applied
    // and can retry it; the reverse order could leave a tenant the runner
    // re-finalizes minutes later.
    await this.writePin({ pin, record, isRetry, priorReport, actorUserId });

    // Only for a status that could have reached the ledger. A `parked`
    // organization and one with no record never cut over, so there is
    // nothing for an effect to undo and no defined meaning for running one.
    if (record === null || !ROLLBACK_EFFECT_STATUSES.includes(record.status)) {
      return;
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

/**
 * One status for a targeted run over an organization's members: the WORST
 * outcome wins (parked over held over finalized), because the operator is
 * deciding whether the organization needs attention, and null when no
 * member was in the cohort at all. Members already terminal before the run
 * keep their terminal color: rolled-back members answer "rolled_back" (an
 * operator's pin is never a successful finalization), and a membership
 * finished earlier answers "finalized" - done, not "nobody was in the
 * cohort".
 *
 * A member another pass was working reads as held, for the same reason: the
 * organization is not finished, and the next pass picks that member up.
 */
function statusOfMemberSummary(
  summary: MigrationPassSummary,
): TenantMigrationStatus | null {
  if (summary.parked > 0) return "parked";
  if (summary.held > 0 || summary.claimed > 0) return "migrated";
  if (summary.alreadyRolledBack > 0) return "rolled_back";
  if (summary.finalized > 0 || summary.alreadyFinalized > 0) {
    return "finalized";
  }
  return null;
}
