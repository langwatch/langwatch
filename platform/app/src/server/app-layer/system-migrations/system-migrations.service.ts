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
  // Not a rollback but a RETRY of one: the pin already stands and only the
  // effect re-fires. See `rollBack`.
  "rolled_back",
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
      // finish the one already recorded.
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
