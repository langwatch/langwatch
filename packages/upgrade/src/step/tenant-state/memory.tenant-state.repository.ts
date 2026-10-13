import {
  SystemMigrationRecordNotFoundError,
  type SystemMigrationStateRepository,
  type TenantMigrationRecord,
  type TenantMigrationStatus,
} from "@langwatch/system-migrations";
import { nowInstant, Temporal } from "@langwatch/time";

import type { TenantStepStateRow } from "./tenant-state.repository.ts";
import type { TenantStepLedger } from "./tenant-step-settle.service.ts";

/** The tenant step state table's twin, for tests and the memory tier. */
export class MemoryTenantStepStateRepository implements SystemMigrationStateRepository {
  private readonly records = new Map<string, TenantStepStateRow>();

  static create(): MemoryTenantStepStateRepository {
    return new MemoryTenantStepStateRepository();
  }

  private constructor() {}

  async getRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord> {
    const record = this.records.get(keyOf({ migrationName, tenantId }));
    if (!record) throw new SystemMigrationRecordNotFoundError({ migrationName, tenantId });
    return record;
  }

  async findRecords({
    migrationName,
    tenantIds,
  }: {
    migrationName: string;
    tenantIds: readonly string[];
  }): Promise<TenantMigrationRecord[]> {
    return tenantIds.flatMap((tenantId) => {
      const record = this.records.get(keyOf({ migrationName, tenantId }));
      return record ? [record] : [];
    });
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    this.records.set(keyOf(record), { ...record, updatedAt: nowInstant() });
  }

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean> {
    if (this.records.get(keyOf(record))?.status === "rolled_back") return false;
    this.records.set(keyOf(record), { ...record, updatedAt: nowInstant() });
    return true;
  }

  async hasTenantAwaitingRedrive({
    migrationNames,
  }: {
    migrationNames: readonly string[];
  }): Promise<boolean> {
    return [...this.records.values()].some(
      (record) =>
        migrationNames.includes(record.migrationName) &&
        (record.status === "parked" || record.status === "migrated"),
    );
  }

  async findStatusCounts({
    migrationName,
  }: {
    migrationName: string;
  }): Promise<Record<TenantMigrationStatus, number>> {
    const counts: Record<TenantMigrationStatus, number> = {
      migrated: 0,
      finalized: 0,
      parked: 0,
      rolled_back: 0,
    };
    for (const record of this.records.values()) {
      if (record.migrationName === migrationName) counts[record.status] += 1;
    }
    return counts;
  }

  async findRecordsByStatus({
    migrationName,
    statuses,
    limit,
    offset = 0,
  }: {
    migrationName?: string | undefined;
    statuses: TenantMigrationStatus[];
    limit: number;
    offset?: number;
  }): Promise<TenantStepStateRow[]> {
    return [...this.records.values()]
      .filter(
        (record) =>
          (migrationName === undefined || record.migrationName === migrationName) &&
          statuses.includes(record.status),
      )
      .toSorted((left, right) => Temporal.Instant.compare(right.updatedAt, left.updatedAt))
      .slice(offset, offset + limit);
  }

  async hasFinalizedTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    return [...this.records.values()].some(
      (record) => record.migrationName === migrationName && record.status === "finalized",
    );
  }

  async hasUnsettledTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    return [...this.records.values()].some(
      (record) =>
        record.migrationName === migrationName &&
        (record.status === "parked" || record.heldReason !== undefined),
    );
  }
}

function keyOf({ migrationName, tenantId }: { migrationName: string; tenantId: string }): string {
  return JSON.stringify([migrationName, tenantId]);
}

/** The ledger's tenant step rows' twin, for tests and the memory tier: settled or not, by id. */
export class MemoryTenantStepLedgerRepository implements TenantStepLedger {
  private readonly rows = new Map<string, boolean>();

  static create(): MemoryTenantStepLedgerRepository {
    return new MemoryTenantStepLedgerRepository();
  }

  private constructor() {}

  async settleTenantStep({ id, settled }: { id: string; settled: boolean }): Promise<void> {
    this.rows.set(id, settled);
  }

  /** Whether the last settle found the step settled; false when it was never settled. */
  isSettled({ id }: { id: string }): boolean {
    return this.rows.get(id) === true;
  }
}
