import { listPrismaMigrationNames } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type MigrationLedgerRow,
  PostgresHealthRepository,
} from "../datastore-health.repository.ts";

/** The server and its migration ledger, neither of which belongs to a tenant. */
export class PrismaPostgresHealthRepository extends PostgresHealthRepository {
  private constructor(private readonly prisma: Pick<PrismaClient, "$queryRaw">) {
    super();
  }

  static create(prisma: Pick<PrismaClient, "$queryRaw">): PrismaPostgresHealthRepository {
    return new PrismaPostgresHealthRepository(prisma);
  }

  async findServerVersion(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ server_version: string }[]>`
      -- @tenancy: asks the server its version, which belongs to no tenant.
      SHOW server_version`;
    return rows[0]?.server_version ?? "unknown version";
  }

  async findMigrationLedger(): Promise<MigrationLedgerRow[]> {
    const rows = await this.prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >`
      -- @tenancy: the migration ledger describes the whole database, not a tenant.
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
    return rows.map((row) => ({
      name: row.migration_name,
      finished: row.finished_at !== null,
      rolledBack: row.rolled_back_at !== null,
    }));
  }

  findReleaseMigrationNames(): Promise<string[]> {
    return listPrismaMigrationNames();
  }
}
