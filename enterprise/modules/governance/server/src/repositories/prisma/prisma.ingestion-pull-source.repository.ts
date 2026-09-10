import type { GovernanceIngestionSource } from "@langwatch/enterprise-governance-contract";
import type { IngestionPullSourceReader } from "../../app/governance.members.ts";
import {
  PrismaIngestionSourceRepository,
  type IngestionSourceDatabase,
} from "./prisma.ingestion-source.repository.ts";

/** Prisma-backed source lookup for the process-owned pull worker. */
export class PrismaIngestionPullSourceRepository implements IngestionPullSourceReader {
  private constructor(private readonly repository: PrismaIngestionSourceRepository) {}

  static create(database: IngestionSourceDatabase): PrismaIngestionPullSourceRepository {
    return new PrismaIngestionPullSourceRepository(PrismaIngestionSourceRepository.create(database));
  }

  findById(id: string): Promise<GovernanceIngestionSource | null> {
    return this.repository.findById(id);
  }
}
