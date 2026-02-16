import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { ClickHouseSimulationService } from "~/server/simulations/clickhouse-simulation.service";
import { SimulationDispatcher } from "~/server/simulations/dispatch";
import { createLogger } from "~/utils/logger/server";
import { ScenarioEventType, ScenarioRunStatus } from "./enums";
import { ScenarioEventRepository } from "./scenario-event.repository";
import type { ScenarioEvent, ScenarioRunData } from "./types";

const tracer = getLangWatchTracer("langwatch.scenario-events.service");
const logger = createLogger("langwatch:scenario-events:service");

/**
 * Service responsible for managing scenario events and their associated data.
 * Handles operations like saving events, retrieving run data, and managing project-wide event operations.
 */
export class ScenarioEventService {
  private eventRepository: ScenarioEventRepository;

  constructor() {
    this.eventRepository = new ScenarioEventRepository();
  }

  /**
   * Saves a scenario event to the repository and dual-writes to ClickHouse
   * when the event-sourcing ingestion flag is enabled for the project.
   */
  async saveScenarioEvent({
    projectId,
    ...event
  }: {
    projectId: string;
  } & ScenarioEvent) {
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
          ...(event as ScenarioEvent),
        });

        // Dual-write to ClickHouse (feature-flagged, errors swallowed by dispatcher)
        const dispatcher = SimulationDispatcher.create();
        if (await dispatcher.isClickHouseEnabled(projectId)) {
          const basePayload = {
            tenantId: projectId,
            scenarioRunId: event.scenarioRunId,
            scenarioId: event.scenarioId,
            batchRunId: event.batchRunId,
            scenarioSetId: event.scenarioSetId ?? "default",
            occurredAt: event.timestamp,
          };

          if (event.type === ScenarioEventType.RUN_STARTED) {
            await dispatcher.startRun({ ...basePayload, metadata: event.metadata });
          } else if (event.type === ScenarioEventType.MESSAGE_SNAPSHOT) {
            await dispatcher.messageSnapshot({ ...basePayload, messages: event.messages });
          } else if (event.type === ScenarioEventType.RUN_FINISHED) {
            await dispatcher.finishRun({ ...basePayload, status: event.status, results: event.results });
          }
        }
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

        return {
          scenarioId: runStartedEvent.scenarioId,
          batchRunId: runStartedEvent.batchRunId,
          scenarioRunId: runStartedEvent.scenarioRunId,
          status: latestRunFinishedEvent?.status ?? ScenarioRunStatus.IN_PROGRESS,
          results: latestRunFinishedEvent?.results ?? null,
          messages: latestMessageEvent?.messages ?? [],
          timestamp: latestMessageEvent?.timestamp ?? runStartedEvent.timestamp,
          name: runStartedEvent?.metadata?.name ?? null,
          description: runStartedEvent?.metadata?.description ?? null,
          durationInMs:
            runStartedEvent?.timestamp && latestRunFinishedEvent?.timestamp
              ? latestRunFinishedEvent.timestamp - runStartedEvent.timestamp
              : 0,
        };
      },
    );
  }

  /**
   * Deletes all events associated with a specific project from both
   * Elasticsearch and ClickHouse (no-op when CH client unavailable).
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
        await this.eventRepository.deleteAllEvents({
          projectId,
        });

        // Soft-delete from ClickHouse (no-op when client unavailable)
        const chService = ClickHouseSimulationService.create();
        await chService.softDeleteAllForProject(projectId);
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
        const pageLimit = 100; // repository/server cap
        const maxPages = 200; // safety guard (20k ids)
        let truncated = false;

        for (let i = 0; i < maxPages; i++) {
          const { batchRunIds: ids, nextCursor } =
            await this.eventRepository.getBatchRunIdsForScenarioSet({
              projectId,
              scenarioSetId,
              limit: pageLimit,
              cursor,
            });
          if (ids.length === 0) break;
          ids.forEach((id) => batchRunIds.add(id));

          if (!nextCursor || nextCursor === cursor) break;
          if (i === maxPages - 1 && nextCursor) {
            truncated = true;
            break;
          }
          cursor = nextCursor;
        }
        if (truncated) {
          throw new Error(
            `Too many runs to fetch exhaustively (cap ${maxPages * pageLimit}). ` +
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
   * Retrieves run data for a specific batch run.
   * @param {Object} params - The parameters for retrieving batch run data
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.scenarioSetId - The ID of the scenario set
   * @param {string} params.batchRunId - The ID of the specific batch run
   * @returns {Promise<ScenarioRunData[]>} Array of scenario run data for the batch run
   */
  async getRunDataForBatchRun({
    projectId,
    scenarioSetId,
    batchRunId,
  }: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
  }) {
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

        // Get scenario run IDs for this specific batch run
        const scenarioRunIds =
          await this.eventRepository.getScenarioRunIdsForBatchRun({
            projectId,
            scenarioSetId,
            batchRunId,
          });

        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return [];
        }

        // Use batch method to get the actual run data
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

          runs.push({
            scenarioId: runStartedEvent.scenarioId,
            batchRunId: runStartedEvent.batchRunId,
            scenarioRunId: runStartedEvent.scenarioRunId,
            status: runFinishedEvent?.status ?? ScenarioRunStatus.IN_PROGRESS,
            results: runFinishedEvent?.results ?? null,
            messages: messageEvent?.messages ?? [],
            timestamp: messageEvent?.timestamp ?? runStartedEvent.timestamp,
            name: runStartedEvent?.metadata?.name ?? null,
            description: runStartedEvent?.metadata?.description ?? null,
            durationInMs:
              runStartedEvent?.timestamp && runFinishedEvent?.timestamp
                ? Math.max(
                    0,
                    runFinishedEvent.timestamp - runStartedEvent.timestamp,
                  )
                : 0,
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
}
