import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  topicClusteringRunHistoryEntrySchema,
  type Topic,
  type TopicClusteringRunHistoryEntry,
  type TopicNamesInput,
  type TopicProjectInput,
} from "@langwatch/topic-contract";
import { z } from "zod";

import type { TopicClusteringStatusRecord, TopicRepository } from "../topic.repository.ts";

const runsSchema = z.array(topicClusteringRunHistoryEntrySchema);

/**
 * The three delegates the topic read touches, named rather than taken whole so
 * a process can hand this package its one client without the client's exact
 * generated shape becoming part of the package's contract.
 */
export type TopicDatabase = Pick<
  PrismaClient,
  "topic" | "topicClusteringRunProjection" | "topicClusteringRunHistoryProjection"
>;

export class PrismaTopicRepository
  extends PrismaRepository.for(
    "Topic",
    "TopicClusteringRunProjection",
    "TopicClusteringRunHistoryProjection",
  )
  implements TopicRepository
{
  static readonly create = this.factory((prisma) => new PrismaTopicRepository(prisma));

  async findAll(input: TopicProjectInput): Promise<Topic[]> {
    const rows = await this.prisma.topic.findMany({
      where: { projectId: input.projectId },
      select: {
        id: true,
        name: true,
        parentId: true,
        automaticallyGenerated: true,
      },
    });
    return rows;
  }

  async findNamesByIds(input: TopicNamesInput): Promise<Map<string, string>> {
    if (input.ids.length === 0) return new Map();
    const rows = await this.prisma.topic.findMany({
      where: { projectId: input.projectId, id: { in: input.ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async findClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatusRecord> {
    const projection = await this.prisma.topicClusteringRunProjection.findUnique({
      where: { projectId: input.projectId },
    });

    return {
      projection: projection
        ? {
            lastRequestedAt: projection.LastRequestedAt,
            lastRequestTrigger: projection.LastRequestTrigger,
            lastRunAt: projection.LastRunAt,
            lastRunOutcome: projection.LastRunOutcome,
            lastRunMode: projection.LastRunMode,
            lastRunSkippedReason: projection.LastRunSkippedReason,
            lastRunErrorCode: projection.LastRunErrorCode,
            lastRunErrorUserActionable: projection.LastRunErrorUserActionable,
            lastRunTracesProcessed: projection.LastRunTracesProcessed,
            lastRunTopicsCount: projection.LastRunTopicsCount,
            lastRunSubtopicsCount: projection.LastRunSubtopicsCount,
            inProgressRunId: projection.InProgressRunId,
            inProgressStartedAt: projection.InProgressStartedAt,
            occurredAt: projection.OccurredAt,
          }
        : null,
    };
  }

  async findClusteringRunHistory(
    input: TopicProjectInput,
  ): Promise<TopicClusteringRunHistoryEntry[]> {
    const row = await this.prisma.topicClusteringRunHistoryProjection.findUnique({
      where: { projectId: input.projectId },
      select: { Runs: true },
    });
    if (!row) return [];
    // Malformed projection JSON is an empty rebuildable history.
    const parsed = runsSchema.safeParse(row.Runs);
    return parsed.success ? parsed.data : [];
  }
}
