import { createLogger } from "@langwatch/observability";
import type {
  MigrationPassSummary,
  TenantMigrationRecord,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";
import {
  MigrationRollbackRequiresMigratedOrFinalizedError,
  MigrationStateNotFoundError,
} from "./errors";

/**
 * The statuses a tenant may be rolled back from. Mirrors
 * `LEDGER_WRITE_STATUSES` in ../authz/ledger-write-gate.ts: both are already
 * on the ledger (writes, and possibly reads too), so both are the
 * operator's to pull back onto the legacy path. `parked` never reached the
 * ledger, and `rolled_back` already left it.
 */
const ROLLBACK_ELIGIBLE_STATUSES: readonly TenantMigrationStatus[] = [
  "migrated",
  "finalized",
];

const logger = createLogger("langwatch:ops:system-migrations");

/**
 * The ops model over stored migration state. Deliberately narrower than the
 * runner's own port: the runner reads and writes one tenant at a time; the
 * dashboard reads across them, and its ONE write is the operator rollback —
 * migrated or finalized → rolled_back, the state machine's only
 * human-driven edge.
 */
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
      migrationNames: () => string[];
      runPass: () => Promise<MigrationPassSummary | null>;
      /**
       * What else a rollback has to DO, per migration name. The generic
       * rollback is a state write; a migration whose finalization changed
       * how the running fleet behaves needs that change undone too, and
       * only the migration's own composition knows how (for the authz
       * cutover: a `cutover_rolled_back` fact, the projection flipped off
       * synchronously, the epoch bumped). Migrations with nothing to undo
       * simply have no entry.
       */
      rollbackEffects?: Record<
        string,
        (args: { tenantId: string; actorUserId: string }) => Promise<void>
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
    return Promise.all(
      this.deps.migrationNames().map(async (name) => ({
        name,
        counts: await this.deps.state.findStatusCounts({ migrationName: name }),
        attention: await this.deps.state.findRecordsByStatus({
          migrationName: name,
          statuses: ["migrated", "parked"],
          limit: ATTENTION_LIMIT,
        }),
      })),
    );
  }

  /**
   * Kick a pass now instead of waiting for the next worker boot - the lever
   * for widening a cloud cohort or re-verifying held tenants after
   * remediation. Fire-and-forget: the fleet-wide lease already guarantees a
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
   * operator rolls a migrated organization back to its legacy path"). Both
   * statuses are already live on the ledger (ledger-write-gate.ts) — a
   * migrated-but-not-yet-finalized organization held there by parity drift
   * is exactly the population most likely to need this route. Every other
   * status either never reached the ledger or is the runner's to move. The
   * ledger-write gate always picks the change up within its cache window;
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
    const priorReport =
      record.report != null && typeof record.report === "object"
        ? (record.report as Record<string, unknown>)
        : {};
    await this.deps.state.upsertRecord({
      ...record,
      status: "rolled_back",
      report: {
        ...priorReport,
        rolledBack: { by: actorUserId, at: new Date().toISOString() },
      },
    });
    logger.warn(
      { migrationName, tenantId, actorUserId, priorStatus: record.status },
      "operator rolled a migrated or finalized tenant back to its legacy path",
    );
    // The pin FIRST, its effects after — deliberately in that order. The
    // stored `rolled_back` status is what stops the next pass re-finalizing
    // the tenant, so it must land even if the effect cannot. An effect that
    // throws therefore leaves the pin standing and propagates to the
    // operator, who sees a rollback that was recorded but not fully applied
    // and can retry it; the reverse order could leave a tenant the runner
    // re-finalizes minutes later.
    await this.deps.rollbackEffects?.[migrationName]?.({
      tenantId,
      actorUserId,
    });
  }
}
