import type { StateProjectionStore } from "@langwatch/eventing";
import type { IngestionPullRunStatusData } from "../projections/ingestion-pull-run-status-eventing.projection.ts";
import {
  PrismaIngestionPullRunProjectionRepository,
  type IngestionPullRunProjectionDatabase,
} from "../repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts";

/** Public composition seam; the generated Prisma repository stays private. */
export class PostgresIngestionPullRunProjectionAdapter {
  private constructor(private readonly database: IngestionPullRunProjectionDatabase) {}

  static create(
    database: IngestionPullRunProjectionDatabase,
  ): PostgresIngestionPullRunProjectionAdapter {
    return new PostgresIngestionPullRunProjectionAdapter(database);
  }

  build(): StateProjectionStore<IngestionPullRunStatusData> {
    return PrismaIngestionPullRunProjectionRepository.create(this.database);
  }
}
