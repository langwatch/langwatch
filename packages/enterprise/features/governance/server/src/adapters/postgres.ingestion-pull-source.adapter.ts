import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import { IngestionPullSourcePort } from "../ports/ingestion-pull-worker.port";
import { PrismaIngestionSourceRepository } from "../repositories/prisma/prisma.ingestion-source.repository";

/** Prisma-backed source lookup for the process-owned pull worker. */
export class PostgresIngestionPullSourceAdapter extends IngestionPullSourcePort {
  private constructor(private readonly repository: PrismaIngestionSourceRepository) {
    super();
  }

  static create(database: object): PostgresIngestionPullSourceAdapter {
    return new PostgresIngestionPullSourceAdapter(
      PrismaIngestionSourceRepository.create(database),
    );
  }

  tryFindById(id: string): Promise<GovernanceIngestionSource | null> {
    return this.repository.tryFindById(id);
  }
}
