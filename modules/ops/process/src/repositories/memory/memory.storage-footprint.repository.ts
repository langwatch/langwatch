import type {
  BackupStatusRow,
  StorageFootprintRepository,
} from "../storage-footprint.repository.ts";
import type { StorageStatsReading } from "../storage-stats-readings.repository.ts";

/** An endpoint holding whatever a test wrote; a read named in `refusals` throws its error. */
export class MemoryStorageFootprintRepository implements StorageFootprintRepository {
  tables: StorageStatsReading["tables"] = [];
  disks: StorageStatsReading["disks"] = [];
  backupStatuses: BackupStatusRow[] = [];
  refusals: { tables?: () => Error; disks?: () => Error; backups?: () => Error } = {};

  private constructor() {}

  static create(): MemoryStorageFootprintRepository {
    return new MemoryStorageFootprintRepository();
  }

  async findTables({
    tables,
  }: {
    tables: readonly string[];
  }): Promise<StorageStatsReading["tables"]> {
    if (this.refusals.tables) throw this.refusals.tables();
    return this.tables.filter((row) => tables.includes(row.table));
  }

  async findDisks(): Promise<StorageStatsReading["disks"]> {
    if (this.refusals.disks) throw this.refusals.disks();
    return [...this.disks];
  }

  async findBackupStatuses(): Promise<BackupStatusRow[]> {
    if (this.refusals.backups) throw this.refusals.backups();
    return [...this.backupStatuses];
  }
}
