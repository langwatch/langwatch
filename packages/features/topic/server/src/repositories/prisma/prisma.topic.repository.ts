import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  topicClusteringRunHistoryEntrySchema,
  topicSchema,
  type Topic,
  type TopicClusteringRunHistoryEntry,
  type TopicNamesInput,
  type TopicProjectInput,
} from "@langwatch/topic-contract";
import { z } from "zod";
import type { TopicClusteringStatusRecord, TopicRepository } from "../topic.repository.ts";

const projectionSchema = z.object({
  LastRequestedAt: z.number().nullable(),
  LastRequestTrigger: z.string().nullable(),
  LastRunAt: z.number().nullable(),
  LastRunOutcome: z.string().nullable(),
  LastRunMode: z.string().nullable(),
  LastRunSkippedReason: z.string().nullable(),
  LastRunErrorCode: z.string().nullable(),
  LastRunErrorUserActionable: z.boolean(),
  LastRunTracesProcessed: z.number().int().nonnegative(),
  LastRunTopicsCount: z.number().int().nonnegative(),
  LastRunSubtopicsCount: z.number().int().nonnegative(),
  InProgressRunId: z.string().nullable(),
  InProgressStartedAt: z.number().nullable(),
  OccurredAt: z.number(),
});

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
    return rows.map((row) => topicSchema.parse(row));
  }

  async findNamesByIds(input: TopicNamesInput): Promise<Map<string, string>> {
    if (input.ids.length === 0) return new Map();
    const rows = await this.prisma.topic.findMany({
      where: { projectId: input.projectId, id: { in: input.ids } },
      select: { id: true, name: true },
    });
    return new Map(
      rows.map((row) => {
        const parsed = z.object({ id: z.string(), name: z.string() }).parse(row);
        return [parsed.id, parsed.name];
      }),
    );
  }

  async findClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatusRecord> {
    const projection = await this.prisma.topicClusteringRunProjection.findUnique({
      where: { projectId: input.projectId },
    });

    const parsed = projection ? projectionSchema.parse(projection) : null;
    return {
      projection: parsed
        ? {
            lastRequestedAt: parsed.LastRequestedAt,
            lastRequestTrigger: parsed.LastRequestTrigger,
            lastRunAt: parsed.LastRunAt,
            lastRunOutcome: parsed.LastRunOutcome,
            lastRunMode: parsed.LastRunMode,
            lastRunSkippedReason: parsed.LastRunSkippedReason,
            lastRunErrorCode: parsed.LastRunErrorCode,
            lastRunErrorUserActionable: parsed.LastRunErrorUserActionable,
            lastRunTracesProcessed: parsed.LastRunTracesProcessed,
            lastRunTopicsCount: parsed.LastRunTopicsCount,
            lastRunSubtopicsCount: parsed.LastRunSubtopicsCount,
            inProgressRunId: parsed.InProgressRunId,
            inProgressStartedAt: parsed.InProgressStartedAt,
            occurredAt: parsed.OccurredAt,
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
