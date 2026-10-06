import type { OpsMigrationOverview } from "@langwatch/ops-contract";
import {
  SystemMigrationRecordNotFoundError,
  type TenantMigrationRecord,
  type TenantMigrationStatus,
} from "@langwatch/system-migrations";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

import type { SystemMigrationStateRepository } from "../system-migration-state.repository.ts";

type StoredRecord = TenantMigrationRecord & { updatedAt: Instant };

/** The migration ledger in one process's memory, keyed as the table is: migration, then tenant. */
export class MemorySystemMigrationStateRepository implements SystemMigrationStateRepository {
  readonly #records = new Map<string, StoredRecord>();

  static create(): MemorySystemMigrationStateRepository {
    return new MemorySystemMigrationStateRepository();
  }

  private constructor() {}

  async getRecord({
    migrationName,
    tenantId,
  }: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord> {
    const record = this.#records.get(keyOf({ migrationName, tenantId }));
    if (!record) throw new SystemMigrationRecordNotFoundError({ migrationName, tenantId });
    const { updatedAt: _updatedAt, ...stored } = record;
    return stored;
  }

  async upsertRecord(record: TenantMigrationRecord): Promise<void> {
    this.#records.set(keyOf(record), { ...record, updatedAt: nowInstant() });
  }

  async upsertRecordUnlessRolledBack(record: TenantMigrationRecord): Promise<boolean> {
    if (this.#records.get(keyOf(record))?.status === "rolled_back") return false;
    await this.upsertRecord(record);
    return true;
  }

  async hasFinalizedTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    return this.#all().some(
      (record) => record.migrationName === migrationName && record.status === "finalized",
    );
  }

  async hasTenantAwaitingRedrive({
    migrationNames,
  }: {
    migrationNames: readonly string[];
  }): Promise<boolean> {
    return this.#all().some(
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
    for (const record of this.#all()) {
      if (record.migrationName === migrationName) counts[record.status] += 1;
    }
    return counts;
  }

  async findRecordsByStatus({
    migrationName,
    statuses,
    limit,
  }: {
    migrationName: string;
    statuses: TenantMigrationStatus[];
    limit: number;
  }): Promise<OpsMigrationOverview["attention"]> {
    return this.#all()
      .filter(
        (record) => record.migrationName === migrationName && statuses.includes(record.status),
      )
      .toSorted(
        (left, right) => right.updatedAt.epochMilliseconds - left.updatedAt.epochMilliseconds,
      )
      .slice(0, limit)
      .map((record) => ({ ...record, updatedAt: toDate(record.updatedAt) }));
  }

  #all(): StoredRecord[] {
    return [...this.#records.values()];
  }
}

function keyOf({ migrationName, tenantId }: { migrationName: string; tenantId: string }): string {
  return `${migrationName}\u0000${tenantId}`;
}
