import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { IngestionPullSourcePort } from "../ports/ingestion-pull-worker.port.ts";
import {
  PrismaIngestionSourceRepository,
  type IngestionSourceDatabase,
} from "../repositories/prisma/prisma.ingestion-source.repository.ts";

/** Prisma-backed source lookup for the process-owned pull worker. */
export class PostgresIngestionPullSourceAdapter extends IngestionPullSourcePort {
  private constructor(private readonly repository: PrismaIngestionSourceRepository) {
    super();
  }

  static create(database: IngestionSourceDatabase): PostgresIngestionPullSourceAdapter {
    return new PostgresIngestionPullSourceAdapter(PrismaIngestionSourceRepository.create(database));
  }

  tryFindById(id: string): Promise<GovernanceIngestionSource | null> {
    return this.repository.tryFindById(id);
  }
}
