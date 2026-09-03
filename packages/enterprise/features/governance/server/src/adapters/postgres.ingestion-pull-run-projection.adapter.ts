import type { StateProjectionStore } from "@langwatch/eventing";
import type { IngestionPullRunStatusData } from "../projections/ingestion-pull-run-status-eventing.projection";
import { PrismaIngestionPullRunProjectionRepository } from "../repositories/prisma/prisma.ingestion-pull-run-projection.repository";

/** Public composition seam; the generated Prisma repository stays private. */
export class PostgresIngestionPullRunProjectionAdapter {
  private constructor(private readonly database: object) {}

  static create(database: object): PostgresIngestionPullRunProjectionAdapter {
    return new PostgresIngestionPullRunProjectionAdapter(database);
  }

  build(): StateProjectionStore<IngestionPullRunStatusData> {
    return PrismaIngestionPullRunProjectionRepository.create(this.database);
  }
}
