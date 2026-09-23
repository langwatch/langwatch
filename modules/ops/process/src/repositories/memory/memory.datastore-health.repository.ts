import type {
  ClickHouseHealthRepository,
  MigrationLedgerRow,
  PostgresHealthRepository,
  RedisHealthRepository,
} from "../datastore-health.repository.ts";

/** Every datastore healthy, with the ledger a test wrote; `down` makes each ping throw. */
export class MemoryDatastoreHealthRepository
  implements PostgresHealthRepository, ClickHouseHealthRepository, RedisHealthRepository
{
  readonly ledger: MigrationLedgerRow[] = [];
  readonly releaseMigrations: string[] = [];
  migrationStatus = "";
  down = false;

  private constructor() {}

  static create(): MemoryDatastoreHealthRepository {
    return new MemoryDatastoreHealthRepository();
  }

  async findServerVersion(): Promise<string> {
    await this.ping();
    return "memory";
  }

  async findMigrationLedger(): Promise<MigrationLedgerRow[]> {
    return [...this.ledger];
  }

  async findReleaseMigrationNames(): Promise<string[]> {
    return [...this.releaseMigrations];
  }

  async readMigrationStatus(): Promise<string> {
    await this.ping();
    return this.migrationStatus;
  }

  describeTarget(): string {
    return "memory";
  }

  async ping(): Promise<void> {
    if (this.down) throw new Error("connect ECONNREFUSED");
  }
}
