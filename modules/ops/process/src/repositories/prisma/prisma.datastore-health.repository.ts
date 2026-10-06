import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { PostgresHealthRepository } from "../datastore-health.repository.ts";

/** Whether the server answers, which belongs to no tenant. */
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
}
