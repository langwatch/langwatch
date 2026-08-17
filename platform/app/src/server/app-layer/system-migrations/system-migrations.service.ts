import { createLogger } from "@langwatch/observability";
import type {
  MigrationPassSummary,
  TenantMigrationRecord,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";

const logger = createLogger("langwatch:ops:system-migrations");

/**
 * The ops read model over stored migration state. Deliberately narrower than
 * the runner's own port: the runner reads and writes one tenant at a time,
 * the dashboard reads across them and writes nothing.
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
}
