import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { ScenarioEventRepository } from "./scenario-event.repository";
import type {
  BatchHistoryResult,
  BatchRunDataResult,
  ScenarioEvent,
  ScenarioRunData,
} from "./scenario-event.types";
import { resolveRunStatus } from "./stall-detection";

const tracer = getLangWatchTracer("langwatch.scenario-events.service");
const logger = createLogger("langwatch:scenario-events:service");

const ALL_RUNS_PAGE_LIMIT = 100;
const ALL_RUNS_MAX_PAGES = 200; // safety: caps total fetch at 20 000 batch IDs

/**
 * Computes the most recent event timestamp across all event types for a scenario run.
 */
function computeLastEventTimestamp({
  runStartedTimestamp,
  messageTimestamp,
  runFinishedTimestamp,
}: {
  runStartedTimestamp: number;
  messageTimestamp: number | undefined;
  runFinishedTimestamp: number | undefined;
}): number {
  return Math.max(
    runStartedTimestamp,
    messageTimestamp ?? 0,
    runFinishedTimestamp ?? 0,
  );
}

/**
 * Service responsible for managing scenario events and their associated data.
 * Handles operations like saving events, retrieving run data, and managing project-wide event operations.
 */
export class ScenarioEventService {
  constructor(private eventRepository = new ScenarioEventRepository()) {}

  /**
   * Saves a scenario event to the repository.
   * @param {Object} params - The parameters for saving the event
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.type - The type of event
   * @param {string} params.scenarioId - The ID of the scenario
   * @param {string} params.scenarioRunId - The ID of the scenario run
   * @param {Object} [params.metadata] - Additional metadata for the event
   */
  async saveScenarioEvent({
    projectId,
    ...event
  }: ScenarioEvent & { projectId: string }) {
    return tracer.withActiveSpan(
      "ScenarioEventService.saveScenarioEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.id": event.scenarioId,
          "scenario.run.id": event.scenarioRunId,
          "event.type": event.type,
        },
      },
      async () => {
        logger.debug(
          { projectId, scenarioId: event.scenarioId, scenarioRunId: event.scenarioRunId, type: event.type },
          "Saving scenario event",
        );
        await this.eventRepository.saveEvent({
          projectId,
          ...event,
        });
      },
    );
  }

  /**
   * Retrieves the complete run data for a specific scenario run.
   * @param {Object} params - The parameters for retrieving run data
   * @param {string} params.scenarioRunId - The ID of the scenario run
   * @param {string} params.projectId - The ID of the project
   * @returns {Promise<ScenarioRunData | null>} The scenario run data or null if not found
   */
  async getScenarioRunData({
    scenarioRunId,
    projectId,
  }: {
    scenarioRunId: string;
    projectId: string;
  }): Promise<ScenarioRunData | null> {
    return tracer.withActiveSpan(
      "ScenarioEventService.getScenarioRunData",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.run.id": scenarioRunId,
        },
      },
      async (span) => {
        logger.debug({ projectId, scenarioRunId }, "Fetching scenario run data");

        // Get run started event using dedicated repository method
        const runStartedEvent =
          await this.eventRepository.getRunStartedEventByScenarioRunId({
            projectId,
            scenarioRunId,
          });

        if (!runStartedEvent) {
          span.setAttribute("result.found", false);
          return null;
        }

        // Get latest message snapshot event using dedicated repository method (optional)
        const latestMessageEvent =
          await this.eventRepository.getLatestMessageSnapshotEventByScenarioRunId({
            projectId,
            scenarioRunId,
          });

        // Get latest run finished event using dedicated repository method
        const latestRunFinishedEvent =
          await this.eventRepository.getLatestRunFinishedEventByScenarioRunId({
            projectId,
            scenarioRunId,
          });

        span.setAttribute("result.found", true);
        span.setAttribute("scenario.id", runStartedEvent.scenarioId);

        // Determine the most recent event timestamp across all event types
        const lastEventTimestamp = computeLastEventTimestamp({
          runStartedTimestamp: runStartedEvent.timestamp,
          messageTimestamp: latestMessageEvent?.timestamp,
          runFinishedTimestamp: latestRunFinishedEvent?.timestamp,
        });

        return {
          scenarioId: runStartedEvent.scenarioId,
          batchRunId: runStartedEvent.batchRunId,
          scenarioRunId: runStartedEvent.scenarioRunId,
          status: resolveRunStatus({
            finishedStatus: latestRunFinishedEvent?.status,
            lastEventTimestamp,
          }),
          results: latestRunFinishedEvent?.results ?? null,
          messages: latestMessageEvent?.messages ?? [],
          timestamp: latestMessageEvent?.timestamp ?? runStartedEvent.timestamp,
          name: runStartedEvent?.metadata?.name ?? null,
          description: runStartedEvent?.metadata?.description ?? null,
          metadata: runStartedEvent?.metadata ?? null,
          durationInMs: latestRunFinishedEvent
            ? latestRunFinishedEvent.timestamp - runStartedEvent.timestamp
            : lastEventTimestamp - runStartedEvent.timestamp,
        };
      },
    );
  }

  /**
   * Deletes all events associated with a specific project.
   * @param {Object} params - The parameters for deletion
   * @param {string} params.projectId - The ID of the project
   * @returns {Promise<void>}
   */
  async deleteAllEventsForProject({ projectId }: { projectId: string }) {
    return tracer.withActiveSpan(
      "ScenarioEventService.deleteAllEventsForProject",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
        },
      },
      async () => {
        logger.debug({ projectId }, "Deleting all events for project");
        return await this.eventRepository.deleteAllEvents({
          projectId,
        });
      },
    );
  }

  /**
   * Retrieves run data for a specific scenario (by scenarioId).
   * Single Responsibility: fetch run data for one scenario without mixing set-level concerns.
   * Note: Temporary implementation; optimize batching later.
   * @param {Object} params - The parameters for retrieving scenario run data
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.scenarioId - The ID of the scenario
   * @returns {Promise<ScenarioRunData[] | null>} Array of scenario run data or null if no runs found
   */
  async getScenarioRunDataByScenarioId({
    projectId,
    scenarioId,
  }: {
    projectId: string;
    scenarioId: string;
  }) {
    return tracer.withActiveSpan(
      "ScenarioEventService.getScenarioRunDataByScenarioId",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.id": scenarioId,
        },
      },
      async (span) => {
        logger.debug({ projectId, scenarioId }, "Fetching scenario run data by scenario id");

        const scenarioRunIds =
          await this.eventRepository.getScenarioRunIdsForScenario({
            projectId,
            scenarioId,
          });

        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return null;
        }

        // Use batch method instead of N+1 queries
        const runs = await this.getScenarioRunDataBatch({
          projectId,
          scenarioRunIds,
        });

        span.setAttribute("result.count", runs.length);
        return runs;
      },
    );
  }

  /**
   * Retrieves scenario sets data for a specific project.
   * @param {Object} params - The parameters for retrieving scenario sets
   * @param {string} params.projectId - The ID of the project
   * @returns {Promise<any>} The scenario sets data
   */
  async getScenarioSetsDataForProject({ projectId }: { projectId: string }) {
    return tracer.withActiveSpan(
      "ScenarioEventService.getScenarioSetsDataForProject",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId }, "Fetching scenario sets data for project");
        const result = await this.eventRepository.getScenarioSetsDataForProject({
          projectId,
        });
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  /**
   * Retrieves run data for all scenarios in a scenario set with cursor-based pagination.
   * Note: This is a temporary implementation that may be optimized in the future.
   * TODO: Optimize this.
   * @param {Object} params - The parameters for retrieving run data
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.scenarioSetId - The ID of the scenario set
   * @param {number} [params.limit] - Maximum number of runs to return
   * @param {string} [params.cursor] - Cursor for pagination
   * @returns {Promise<{runs: ScenarioRunData[], nextCursor?: string, hasMore: boolean}>} Paginated scenario run data
   */
  async getRunDataForScenarioSet({
    projectId,
    scenarioSetId,
    limit = 20,
    cursor,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }) {
    return tracer.withActiveSpan(
      "ScenarioEventService.getRunDataForScenarioSet",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
          "pagination.limit": limit,
          "pagination.has_cursor": cursor !== undefined,
        },
      },
      async (span) => {
        logger.debug({ projectId, scenarioSetId, limit, hasCursor: !!cursor }, "Fetching run data for scenario set");

        // Validate limit to prevent abuse
        const validatedLimit = Math.min(Math.max(1, limit), 100);

        // Use the new cursor-based repository method
        const result = await this.eventRepository.getBatchRunIdsForScenarioSet({
          projectId,
          scenarioSetId,
          limit: validatedLimit,
          cursor,
        });

        if (result.batchRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return {
            runs: [],
            nextCursor: undefined,
            hasMore: false,
          };
        }

        const runs = await this.getRunDataForBatchIds({
          projectId,
          batchRunIds: result.batchRunIds,
        });

        span.setAttribute("result.count", runs.length);
        span.setAttribute("result.has_more", result.hasMore);

        return {
          runs,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        };
      },
    );
  }

  /**
   * Retrieves ALL run data for a scenario set without pagination.
   * Used when the full dataset is needed (e.g., for simulation grids).
   * @param {Object} params - The parameters for retrieving run data
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.scenarioSetId - The ID of the scenario set
   * @returns {Promise<ScenarioRunData[]>} Array of all scenario run data
   */
  async getAllRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]> {
    return tracer.withActiveSpan(
      "ScenarioEventService.getAllRunDataForScenarioSet",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
        },
      },
      async (span) => {
        logger.debug({ projectId, scenarioSetId }, "Fetching all run data for scenario set");

        const batchRunIds = new Set<string>();
        let cursor: string | undefined = undefined;
        let truncated = false;

        for (let i = 0; i < ALL_RUNS_MAX_PAGES; i++) {
          const { batchRunIds: ids, nextCursor } =
            await this.eventRepository.getBatchRunIdsForScenarioSet({
              projectId,
              scenarioSetId,
              limit: ALL_RUNS_PAGE_LIMIT,
              cursor,
            });
          if (ids.length === 0) break;
          ids.forEach((id) => batchRunIds.add(id));

          if (!nextCursor || nextCursor === cursor) break;
          if (i === ALL_RUNS_MAX_PAGES - 1 && nextCursor) {
            truncated = true;
            break;
          }
          cursor = nextCursor;
        }
        if (truncated) {
          throw new Error(
            `Too many runs to fetch exhaustively (cap ${ALL_RUNS_MAX_PAGES * ALL_RUNS_PAGE_LIMIT}). ` +
              "Refine filters or use the paginated API.",
          );
        }

        if (batchRunIds.size === 0) {
          span.setAttribute("result.count", 0);
          return [];
        }

        const runs = await this.getRunDataForBatchIds({
          projectId,
          batchRunIds: Array.from(batchRunIds),
        });

        span.setAttribute("result.count", runs.length);
        span.setAttribute("batch_run_ids.count", batchRunIds.size);

        return runs;
      },
    );
  }

  /**
   * Returns pre-aggregated batch history for the sidebar (ES path).
   * Builds BatchHistoryItem[] by doing per-batch queries; no full messages in output.
   */
  async getBatchHistoryForScenarioSet({
    projectId,
    scenarioSetId,
    limit = 8,
    cursor,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }): Promise<BatchHistoryResult> {
    return tracer.withActiveSpan(
      "ScenarioEventService.getBatchHistoryForScenarioSet",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
        },
      },
      async (span) => {
        const validatedLimit = Math.min(Math.max(1, limit), 100);

        const { batchRunIds, nextCursor, hasMore } =
          await this.eventRepository.getBatchRunIdsForScenarioSet({
            projectId,
            scenarioSetId,
            limit: validatedLimit,
            cursor,
          });

        if (batchRunIds.length === 0) {
          return { batches: [], nextCursor: undefined, hasMore: false, lastUpdatedAt: 0, totalCount: 0 };
        }

        // Fetch total count in parallel with run data
        const [runs, totalCount] = await Promise.all([
          this.getRunDataForBatchIds({ projectId, batchRunIds }),
          this.eventRepository.getBatchRunCountForScenarioSet({ projectId, scenarioSetId }),
        ]);

        // Group by batchRunId and build BatchHistoryItem
        const batchMap = new Map<string, ScenarioRunData[]>();
        for (const run of runs) {
          const list = batchMap.get(run.batchRunId) ?? [];
          list.push(run);
          batchMap.set(run.batchRunId, list);
        }

        let globalLastUpdatedAt = 0;

        const completedStatuses = new Set(["SUCCESS", "FAILED", "FAILURE", "ERROR", "CANCELLED"]);

        const batches = batchRunIds.map((batchRunId) => {
          const items = batchMap.get(batchRunId) ?? [];
          const lastUpdatedAt = items.reduce((max, r) => Math.max(max, r.timestamp), 0);
          if (lastUpdatedAt > globalLastUpdatedAt) globalLastUpdatedAt = lastUpdatedAt;

          const completedItems = items.filter((r) => completedStatuses.has(r.status));
          const completedTimestamps = completedItems.map((r) => r.timestamp).filter((t) => t > 0);
          const firstCompletedAt = completedTimestamps.length > 0 ? Math.min(...completedTimestamps) : null;
          const nonPendingItems = items.filter((r) => !["STALLED", "IN_PROGRESS", "PENDING"].includes(r.status));
          const nonPendingTimestamps = nonPendingItems.map((r) => r.timestamp).filter((t) => t > 0);
          const allCompletedAt = nonPendingTimestamps.length > 0 ? Math.max(...nonPendingTimestamps) : null;

          return {
            batchRunId,
            totalCount: items.length,
            passCount: items.filter((r) => r.status === "SUCCESS").length,
            failCount: items.filter((r) => completedStatuses.has(r.status) && r.status !== "SUCCESS").length,
            runningCount: items.filter((r) =>
              ["IN_PROGRESS", "PENDING"].includes(r.status),
            ).length,
            stalledCount: items.filter((r) => r.status === "STALLED").length,
            lastRunAt: lastUpdatedAt,
            lastUpdatedAt,
            firstCompletedAt,
            allCompletedAt,
            items: items.map((r) => ({
              scenarioRunId: r.scenarioRunId,
              name: r.name ?? null,
              description: r.description ?? null,
              status: r.status,
              durationInMs: r.durationInMs,
              messagePreview: r.messages.slice(0, 4).map((m) => ({
                role: (m as Record<string, unknown>).role as string ?? "",
                content: (m as Record<string, unknown>).content as string ?? "",
              })),
            })),
          };
        });

        span.setAttribute("result.count", batches.length);
        return { batches, nextCursor, hasMore, lastUpdatedAt: globalLastUpdatedAt, totalCount };
      },
    );
  }

  /**
   * Retrieves run data for a specific batch run.
   * Accepts an optional sinceTimestamp for conditional fetching.
   * @param {Object} params - The parameters for retrieving batch run data
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.scenarioSetId - The ID of the scenario set
   * @param {string} params.batchRunId - The ID of the specific batch run
   * @param {number} [params.sinceTimestamp] - Skip fetch if nothing changed since this timestamp
   * @returns Discriminated union: { changed: false } or { changed: true, runs }
   */
  async getRunDataForBatchRun({
    projectId,
    scenarioSetId,
    batchRunId,
    sinceTimestamp,
  }: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<BatchRunDataResult> {
    return tracer.withActiveSpan(
      "ScenarioEventService.getRunDataForBatchRun",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
          "batch.run.id": batchRunId,
        },
      },
      async (span) => {
        logger.debug({ projectId, scenarioSetId, batchRunId }, "Fetching run data for batch run");

        // Conditional check for ES: compute max event timestamp for this batch
        if (sinceTimestamp !== undefined) {
          const maxTs = await this.eventRepository.getMaxTimestampForBatchRun({
            projectId,
            batchRunId,
          });
          if (maxTs <= sinceTimestamp) {
            span.setAttribute("result.changed", false);
            return { changed: false as const, lastUpdatedAt: maxTs };
          }
        }

        // Get scenario run IDs for this specific batch run
        const scenarioRunIds =
          await this.eventRepository.getScenarioRunIdsForBatchRun({
            projectId,
            scenarioSetId,
            batchRunId,
          });

        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return { changed: true as const, lastUpdatedAt: 0, runs: [] };
        }

        // Use batch method to get the actual run data
        const runs = await this.getScenarioRunDataBatch({
          projectId,
          scenarioRunIds,
        });

        const lastUpdatedAt = runs.reduce((max, r) => Math.max(max, r.timestamp), 0);
        span.setAttribute("result.count", runs.length);
        return { changed: true as const, lastUpdatedAt, runs };
      },
    );
  }

  /**
   * Retrieves run data for multiple batch runs.
   * @param {Object} params - The parameters for retrieving batch run data
   * @param {string} params.projectId - The ID of the project
   * @param {string[]} params.batchRunIds - Array of batch run IDs
   * @returns {Promise<ScenarioRunData[]>} Array of scenario run data
   */
  async getRunDataForBatchIds({
    projectId,
    batchRunIds,
  }: {
    projectId: string;
    batchRunIds: string[];
  }) {
    return tracer.withActiveSpan(
      "ScenarioEventService.getRunDataForBatchIds",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "batch_run_ids.count": batchRunIds.length,
        },
      },
      async (span) => {
        logger.debug({ projectId, batchRunIdsCount: batchRunIds.length }, "Fetching run data for batch ids");

        // 2. Get scenario run IDs
        const scenarioRunIds =
          await this.eventRepository.getScenarioRunIdsForBatchRuns({
            projectId,
            batchRunIds,
          });

        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return [];
        }

        // 3. Use batch method instead of N+1 queries
        const runs = await this.getScenarioRunDataBatch({
          projectId,
          scenarioRunIds,
        });

        span.setAttribute("result.count", runs.length);

        return runs;
      },
    );
  }

  /**
   * Retrieves run data for multiple scenario runs in a single batch operation.
   * Eliminates N+1 query problem by fetching all data in 3 queries instead of 3N queries.
   *
   * @param {Object} params - The parameters for retrieving batch run data
   * @param {string} params.projectId - The ID of the project
   * @param {string[]} params.scenarioRunIds - Array of scenario run IDs
   * @returns {Promise<ScenarioRunData[]>} Array of scenario run data
   */
  async getScenarioRunDataBatch({
    projectId,
    scenarioRunIds,
  }: {
    projectId: string;
    scenarioRunIds: string[];
  }): Promise<ScenarioRunData[]> {
    return tracer.withActiveSpan(
      "ScenarioEventService.getScenarioRunDataBatch",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario_run_ids.count": scenarioRunIds.length,
        },
      },
      async (span) => {
        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return [];
        }

        logger.debug({ projectId, scenarioRunIdsCount: scenarioRunIds.length }, "Batch fetching scenario run data");

        // Dedupe to reduce payload and ensure stable, unique iteration order
        const uniqueScenarioRunIds = Array.from(new Set(scenarioRunIds));

        // Snapshot current time once so every run in the batch is evaluated
        // against the same clock (avoids per-iteration drift).
        const now = Date.now();

        // Fetch all data in 3 batch queries instead of 3N individual queries
        const [runStartedEvents, messageEvents, runFinishedEvents] =
          await Promise.all([
            this.eventRepository.getRunStartedEventsByScenarioRunIds({
              projectId,
              scenarioRunIds: uniqueScenarioRunIds,
            }),
            this.eventRepository.getLatestMessageSnapshotEventsByScenarioRunIds({
              projectId,
              scenarioRunIds: uniqueScenarioRunIds,
            }),
            this.eventRepository.getLatestRunFinishedEventsByScenarioRunIds({
              projectId,
              scenarioRunIds: uniqueScenarioRunIds,
            }),
          ]);

        // Compose the data for each scenario run
        const runs: ScenarioRunData[] = [];

        for (const scenarioRunId of uniqueScenarioRunIds) {
          const runStartedEvent = runStartedEvents.get(scenarioRunId);
          const messageEvent = messageEvents.get(scenarioRunId);
          const runFinishedEvent = runFinishedEvents.get(scenarioRunId);

          // Skip if we don't have the required events
          if (!runStartedEvent) {
            continue;
          }

          // Determine the most recent event timestamp across all event types
          const lastEventTimestamp = computeLastEventTimestamp({
            runStartedTimestamp: runStartedEvent.timestamp,
            messageTimestamp: messageEvent?.timestamp,
            runFinishedTimestamp: runFinishedEvent?.timestamp,
          });

          runs.push({
            scenarioId: runStartedEvent.scenarioId,
            batchRunId: runStartedEvent.batchRunId,
            scenarioRunId: runStartedEvent.scenarioRunId,
            status: resolveRunStatus({
              finishedStatus: runFinishedEvent?.status,
              lastEventTimestamp,
              now,
            }),
            results: runFinishedEvent?.results ?? null,
            messages: messageEvent?.messages ?? [],
            timestamp: messageEvent?.timestamp ?? runStartedEvent.timestamp,
            name: runStartedEvent?.metadata?.name ?? null,
            description: runStartedEvent?.metadata?.description ?? null,
            metadata: runStartedEvent?.metadata ?? null,
            durationInMs: runFinishedEvent
              ? Math.max(0, runFinishedEvent.timestamp - runStartedEvent.timestamp)
              : Math.max(0, lastEventTimestamp - runStartedEvent.timestamp),
          });
        }

        span.setAttribute("result.count", runs.length);

        return runs;
      },
    );
  }

  /**
   * Gets the total count of batch runs for a scenario set.
   * Used for pagination calculations.
   * @param {Object} params - The parameters for retrieving the count
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.scenarioSetId - The ID of the scenario set
   * @returns {Promise<number>} Total count of batch runs
   */
  async getBatchRunCountForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<number> {
    return tracer.withActiveSpan(
      "ScenarioEventService.getBatchRunCountForScenarioSet",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
        },
      },
      async (span) => {
        logger.debug({ projectId, scenarioSetId }, "Getting batch run count for scenario set");
        const count = await this.eventRepository.getBatchRunCountForScenarioSet({
          projectId,
          scenarioSetId,
        });
        span.setAttribute("result.count", count);
        return count;
      },
    );
  }

  /**
   * Retrieves run data for all suites (cross-suite view) with cursor-based pagination.
   * @param {Object} params - The parameters for retrieving run data
   * @param {string} params.projectId - The ID of the project
   * @param {number} [params.limit] - Maximum number of batch runs to return
   * @param {string} [params.cursor] - Cursor for pagination
   * @returns {Promise<{runs: ScenarioRunData[], scenarioSetIds: Record<string, string>, nextCursor?: string, hasMore: boolean}>} Paginated scenario run data with scenario set IDs
   */
  async getRunDataForAllSuites({
    projectId,
    limit = 20,
    cursor,
  }: {
    projectId: string;
    limit?: number;
    cursor?: string;
  }) {
    return tracer.withActiveSpan(
      "ScenarioEventService.getRunDataForAllSuites",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "pagination.limit": limit,
          "pagination.has_cursor": cursor !== undefined,
        },
      },
      async (span) => {
        logger.debug({ projectId, limit, hasCursor: !!cursor }, "Fetching run data for all suites");

        // Validate limit to prevent abuse
        const validatedLimit = Math.min(Math.max(1, limit), 100);

        // Use the new cross-suite repository method
        const result = await this.eventRepository.getBatchRunIdsForAllSuites({
          projectId,
          limit: validatedLimit,
          cursor,
        });

        if (result.batchRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return {
            runs: [],
            scenarioSetIds: {},
            nextCursor: undefined,
            hasMore: false,
          };
        }

        const runs = await this.getRunDataForBatchIds({
          projectId,
          batchRunIds: result.batchRunIds,
        });

        span.setAttribute("result.count", runs.length);
        span.setAttribute("result.has_more", result.hasMore);

        return {
          runs,
          scenarioSetIds: result.scenarioSetIds,
          nextCursor: result.nextCursor,
          hasMore: result.hasMore,
        };
      },
    );
  }
}
