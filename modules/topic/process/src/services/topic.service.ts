import {
  topicClusteringStatusSchema,
  topicNamesInputSchema,
  topicProjectInputSchema,
  type Topic,
  topicClusteringRunHistoryPageInputSchema,
  type TopicClusteringRunHistoryEntry,
  type TopicClusteringRunHistoryPage,
  type TopicClusteringRunHistoryPageInput,
  type TopicClusteringStatus,
  type TopicNamesInput,
  type TopicProjectInput,
  TOPIC_CLUSTERING_STALE_RUN_MS,
} from "@langwatch/topic-contract";

import type { TopicClusteringScheduleReader } from "../app/topic.app.ts";
import type { TopicRepository } from "../repositories/topic.repository.ts";

export class TopicService {
  static create(options: {
    repository: TopicRepository;
    schedule: TopicClusteringScheduleReader;
    now?: () => number;
  }): TopicService {
    return new TopicService(options.repository, options.schedule, options.now ?? Date.now);
  }

  private constructor(
    private readonly repository: TopicRepository,
    private readonly schedule: TopicClusteringScheduleReader,
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
    return this.readRunHistory(topicProjectInputSchema.parse(input));
  }

  /**
   * The next page after `cursor`, the run id of the previous page's last entry. The position is
   * found by that id in the retained list, so a run finishing since the last read changes nothing,
   * and a run the projection has trimmed away answers `cursor_expired`.
   */
  async getClusteringRunHistoryPage(
    input: TopicClusteringRunHistoryPageInput,
  ): Promise<TopicClusteringRunHistoryPage> {
    const { projectId, cursor, limit } = topicClusteringRunHistoryPageInputSchema.parse(input);
    const history = await this.readRunHistory({ projectId });
    const cursorAt = cursor === void 0 ? -1 : history.findIndex((run) => run.runId === cursor);
    if (cursor !== void 0 && cursorAt === -1) return { outcome: "cursor_expired" };

    const start = cursorAt + 1;
    const entries = history.slice(start, start + limit);
    const hasMore = start + limit < history.length;

    return {
      outcome: "page",
      entries,
      hasMore,
      nextCursor: hasMore ? (entries.at(-1)?.runId ?? null) : null,
    };
  }

  private async readRunHistory(
    input: TopicProjectInput,
  ): Promise<TopicClusteringRunHistoryEntry[]> {
    const runs = await this.repository.findClusteringRunHistory(input);

    return runs.map((run) =>
      run.outcome === "running" && this.now() - run.startedAt >= TOPIC_CLUSTERING_STALE_RUN_MS
        ? { ...run, outcome: "abandoned" }
        : run,
    );
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
