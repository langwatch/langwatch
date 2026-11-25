import { fromDate } from "@langwatch/time";

import {
  IngestionPullLifecycleRepository,
  type IngestionPullLifecycleSource,
} from "../ingestion-pull-lifecycle.repository.ts";

export type IngestionPullLifecycleDatabase = {
  ingestionSource: {
    findMany(input: {
      where: {
        OR: ({ pullSchedule: { not: null } } | { id: { in: string[] } })[];
      };
    }): Promise<
      (Omit<IngestionPullLifecycleSource, "updatedAt" | "archivedAt"> & {
        updatedAt: Date;
        archivedAt: Date | null;
      })[]
    >;
  };
};

export class PrismaIngestionPullLifecycleRepository extends IngestionPullLifecycleRepository {
  private constructor(private readonly database: IngestionPullLifecycleDatabase) {
    super();
  }

  static create(database: IngestionPullLifecycleDatabase): PrismaIngestionPullLifecycleRepository {
    return new PrismaIngestionPullLifecycleRepository(database);
  }

  async findForReconciliation({
    processKeys,
  }: {
    processKeys: string[];
  }): Promise<IngestionPullLifecycleSource[]> {
    const sources = await this.database.ingestionSource.findMany({
      where: { OR: [{ pullSchedule: { not: null } }, { id: { in: processKeys } }] },
    });
    return sources.map((source) => ({
      ...source,
      updatedAt: fromDate(source.updatedAt),
      archivedAt: source.archivedAt ? fromDate(source.archivedAt) : null,
    }));
  }
}
