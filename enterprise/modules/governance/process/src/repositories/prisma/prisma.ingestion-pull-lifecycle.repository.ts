import { fromDate } from "@langwatch/time";

import {
  IngestionPullLifecycleRepository,
  type IngestionPullLifecycleDatabase,
  type IngestionPullLifecycleSource,
} from "../ingestion-pull-lifecycle.repository.ts";

const INGESTION_PULL_PROCESS_NAME = "ingestionPull";

export class PrismaIngestionPullLifecycleRepository extends IngestionPullLifecycleRepository {
  private constructor(private readonly database: IngestionPullLifecycleDatabase) {
    super();
  }

  static create(database: IngestionPullLifecycleDatabase): PrismaIngestionPullLifecycleRepository {
    return new PrismaIngestionPullLifecycleRepository(database);
  }

  async findForReconciliation({
    governanceProjectIds,
  }: {
    governanceProjectIds: string[];
  }): Promise<IngestionPullLifecycleSource[]> {
    const processes =
      governanceProjectIds.length === 0
        ? []
        : await this.database.processManagerInstance.findMany({
            where: {
              processName: INGESTION_PULL_PROCESS_NAME,
              projectId: { in: governanceProjectIds },
            },
            select: { processKey: true },
          });

    const sources = await this.database.ingestionSource.findMany({
      where: {
        OR: [
          { pullSchedule: { not: null } },
          { id: { in: processes.map(({ processKey }) => processKey) } },
        ],
      },
    });
    return sources.map((source) => ({
      ...source,
      updatedAt: fromDate(source.updatedAt),
      archivedAt: source.archivedAt ? fromDate(source.archivedAt) : null,
    }));
  }
}
