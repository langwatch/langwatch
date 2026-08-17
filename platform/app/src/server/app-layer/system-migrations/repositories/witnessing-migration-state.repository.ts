import { createLogger } from "@langwatch/observability";
import type {
  TenantMigrationRecord,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";
import type { SystemMigrationStateReader } from "../system-migrations.service";

const logger = createLogger("langwatch:system-migrations:witness");

/** One lifecycle transition, as the grants ledger will record it. */
export type MigrationStateWitness = (args: {
  migrationName: string;
  tenantId: string;
  status: TenantMigrationStatus;
  report: unknown;
  occurredAtMs: number;
}) => Promise<void>;

/**
 * ADR-092 §13 (delivery plan PR 1): the runner's lifecycle transitions
 * become ledger facts. The synchronous state write stays exactly as it was
 * - it is the finalized latch, and the latch must never wait on a queue -
 * and every transition is ALSO witnessed as a `migration_tenant_state_changed`
 * event, so the state table is replayable from the ledger (the projection
 * re-applies transitions under a monotonic guard that can never regress a
 * newer direct write).
 *
 * The witness is best-effort by design: a Redis hiccup must not fail the
 * runner's state write. A lost witness costs replay fidelity for one
 * transition, never correctness - the table is the latch either way.
 * Decorating the repository (rather than the runner) keeps the runner
 * package generic: emitting events is this migration's behaviour, not the
 * runner's.
 */
export class WitnessingSystemMigrationStateRepository
  implements SystemMigrationStateReader
{
  constructor(
    private readonly inner: SystemMigrationStateReader,
    private readonly witness: MigrationStateWitness,
    private readonly now: () => number,
  ) {}

  async findRecord(args: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null> {
    return this.inner.findRecord(args);
  }

  async findStatusCounts(args: {
    migrationName: string;
  }): Promise<Record<TenantMigrationStatus, number>> {
    return this.inner.findStatusCounts(args);
  }

  async findRecordsByStatus(args: {
    migrationName: string;
    statuses: TenantMigrationStatus[];
    limit: number;
  }): Promise<Array<TenantMigrationRecord & { updatedAt: Date }>> {
    return this.inner.findRecordsByStatus(args);
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    await this.inner.upsertRecord(record);
    try {
      await this.witness({
        migrationName: record.migrationName,
        tenantId: record.tenantId,
        status: record.status,
        report: record.report ?? null,
        // Stamped AFTER the direct write, so the projection's monotonic
        // guard sees this witness as at least as new as the row it wrote.
        occurredAtMs: this.now(),
      });
    } catch (error) {
      logger.warn(
        {
          error,
          migrationName: record.migrationName,
          tenantId: record.tenantId,
          status: record.status,
        },
        "migration state transition held but its ledger witness failed",
      );
    }
  }
}
