import {
  topicClusteringStatusSchema,
  topicClusteringRunHistoryEntrySchema,
  topicNamesInputSchema,
  topicProjectInputSchema,
  type Topic,
  type TopicClusteringRunHistoryEntry,
  type TopicClusteringStatus,
  type TopicNamesInput,
  type TopicProjectInput,
} from "@langwatch/topic-contract";
import { TOPIC_CLUSTERING_STALE_RUN_MS } from "@langwatch/topic-contract";
import type { TopicRepository } from "../repositories/topic.repository.ts";
import type { TopicClusteringSchedulePort } from "../ports/topic-clustering-schedule.port.ts";

export class TopicService {
  static create(options: {
    repository: TopicRepository;
    schedule: TopicClusteringSchedulePort;
    now?: () => number;
  }): TopicService {
    return new TopicService(options.repository, options.schedule, options.now ?? Date.now);
  }

  private constructor(
    private readonly repository: TopicRepository,
    private readonly schedule: TopicClusteringSchedulePort,
    private readonly now: () => number,
  ) {}

  getAll(input: TopicProjectInput): Promise<Topic[]> {
    return this.repository.findAll(topicProjectInputSchema.parse(input));
  }

  getNamesByIds(input: TopicNamesInput): Promise<Map<string, string>> {
    return this.repository.findNamesByIds(topicNamesInputSchema.parse(input));
  }

  async getClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatus> {
    const parsed = topicProjectInputSchema.parse(input);
    const [result, nextWakeAt] = await Promise.all([
      this.repository.findClusteringStatus(parsed),
      this.schedule.findNextWakeAt(parsed),
    ]);
    const { projection } = result;
    const lastRequestedAt = projection?.lastRequestedAt ?? null;
    const lastRunAt = projection?.lastRunAt ?? null;
    const isInProgress =
      projection?.inProgressRunId !== null &&
      projection?.inProgressRunId !== undefined &&
      this.now() - (projection.inProgressStartedAt ?? projection.occurredAt) <
        TOPIC_CLUSTERING_STALE_RUN_MS;
    const status = {
      lastRequestedAt,
      lastRequestTrigger: projection?.lastRequestTrigger ?? null,
      lastRunAt,
      lastRunOutcome: projection?.lastRunOutcome ?? null,
      lastRunMode: projection?.lastRunMode ?? null,
      lastRunSkippedReason: projection?.lastRunSkippedReason ?? null,
      lastRunErrorCode: projection?.lastRunErrorCode ?? null,
      isLastRunErrorUserActionable: projection?.lastRunErrorUserActionable ?? false,
      lastRunTracesProcessed: projection?.lastRunTracesProcessed ?? 0,
      lastRunTopicsCount: projection?.lastRunTopicsCount ?? 0,
      lastRunSubtopicsCount: projection?.lastRunSubtopicsCount ?? 0,
      isInProgress,
      isRunInFlight:
        isInProgress ||
        this.hasUnansweredRequest({
          lastRequestedAt,
          lastRunAt,
          lastRequestTrigger: projection?.lastRequestTrigger ?? null,
        }),
      nextRunAt: nextWakeAt?.epochMilliseconds ?? null,
    };

    return topicClusteringStatusSchema.parse(status);
  }

  async getClusteringRunHistory(
    input: TopicProjectInput,
  ): Promise<TopicClusteringRunHistoryEntry[]> {
    const runs = await this.repository.findClusteringRunHistory(
      topicProjectInputSchema.parse(input),
    );

    return runs.map((run) => {
      const parsed = topicClusteringRunHistoryEntrySchema.parse(run);

      return parsed.outcome === "running" &&
        this.now() - parsed.startedAt >= TOPIC_CLUSTERING_STALE_RUN_MS
        ? { ...parsed, outcome: "abandoned" }
        : parsed;
    });
  }

  private hasUnansweredRequest(input: {
    lastRequestedAt: number | null;
    lastRunAt: number | null;
    lastRequestTrigger: string | null;
  }): boolean {
    if (input.lastRequestedAt === null) {
      return false;
    }

    if (input.lastRequestTrigger !== "manual") {
      return false;
    }

    if (input.lastRunAt !== null && input.lastRunAt >= input.lastRequestedAt) {
      return false;
    }

    return this.now() - input.lastRequestedAt < TOPIC_CLUSTERING_STALE_RUN_MS;
  }
}
