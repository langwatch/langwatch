import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProcessManagerPurgeRepository } from "../repositories/process-manager-purge.repository";
import { PrismaProcessManagerPurgeRepository } from "../repositories/prisma/prisma.process-manager-purge.repository";

/** The Postgres seam for the process-manager retention purge. */
export class PostgresProcessManagerPurgeAdapter {
  static create(options: { database: PrismaClient }): ProcessManagerPurgeRepository {
    return PrismaProcessManagerPurgeRepository.create({ database: options.database });
  }
}
