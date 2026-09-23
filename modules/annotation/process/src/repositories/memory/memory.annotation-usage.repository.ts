import type { AnnotationUsageCount } from "@langwatch/annotation-contract";

import type { AnnotationUsageRepository } from "../annotation-usage.repository.ts";
import type { AnnotationRepository } from "../annotation.repository.ts";
import type { MemoryAnnotationQueueDatabase } from "./memory.annotation-queue.database.ts";

export class MemoryAnnotationUsageRepository implements AnnotationUsageRepository {
  private constructor(
    private readonly deps: {
      annotations: AnnotationRepository;
      database: MemoryAnnotationQueueDatabase;
    },
  ) {}

  static create(deps: {
    annotations: AnnotationRepository;
    database: MemoryAnnotationQueueDatabase;
  }): MemoryAnnotationUsageRepository {
    return new MemoryAnnotationUsageRepository(deps);
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<AnnotationUsageCount> {
    const { database } = this.deps;
    const counted = (made: readonly number[]) =>
      made.filter((at) => since === undefined || at >= since).length;
    const inScope = (row: { projectId: string }) => projectIds.includes(row.projectId);
    const annotations = (
      await Promise.all(
        projectIds.map((projectId) => this.deps.annotations.findAll({ projectId, anchor: "all" })),
      )
    ).flat();
    const first = annotations.map((row) => row.createdAt.getTime());
    return {
      annotations: counted(first),
      annotationQueues: counted(
        database
          .queues()
          .filter(inScope)
          .map((row) => row.createdAt.getTime()),
      ),
      annotationQueueItems: counted(
        database
          .items()
          .filter(inScope)
          .map((row) => row.createdAt.getTime()),
      ),
      annotationScores: counted(
        database
          .scores()
          .filter(inScope)
          .map((row) => row.createdAt.getTime()),
      ),
      ...(first.length === 0 ? {} : { firstAnnotationAt: Math.min(...first) }),
    };
  }
}
