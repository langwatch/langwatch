import { ScenarioRunStatus } from "./enums";
import { ScenarioEventRepository } from "./scenario-event.repository";
import type { ScenarioEvent, ScenarioRunData } from "./types";

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
  }: {
    projectId: string;
    type: string;
    scenarioId: string;
    scenarioRunId: string;
    [key: string]: any;
  }) {
    await this.eventRepository.saveEvent({
      projectId,
      ...(event as ScenarioEvent),
    });
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
    // Get run started event using dedicated repository method
    const runStartedEvent =
      await this.eventRepository.getRunStartedEventByScenarioRunId({
        projectId,
        scenarioRunId,
      });

    if (!runStartedEvent) {
      return null;
    }

    // Get latest message snapshot event using dedicated repository method
    const latestMessageEvent =
      await this.eventRepository.getLatestMessageSnapshotEventByScenarioRunId({
        projectId,
        scenarioRunId,
      });

    if (!latestMessageEvent) {
      return null;
    }

    // Get latest run finished event using dedicated repository method
    const latestRunFinishedEvent =
      await this.eventRepository.getLatestRunFinishedEventByScenarioRunId({
        projectId,
        scenarioRunId,
      });

    return {
      scenarioId: latestMessageEvent.scenarioId,
      batchRunId: latestMessageEvent.batchRunId,
      scenarioRunId: latestMessageEvent.scenarioRunId,
      status: latestRunFinishedEvent?.status ?? ScenarioRunStatus.IN_PROGRESS,
      results: latestRunFinishedEvent?.results ?? null,
      messages: latestMessageEvent.messages ?? [],
      timestamp: latestMessageEvent.timestamp ?? 0,
      name: runStartedEvent?.metadata?.name ?? null,
      description: runStartedEvent?.metadata?.description ?? null,
      durationInMs:
        runStartedEvent?.timestamp && latestRunFinishedEvent?.timestamp
          ? latestRunFinishedEvent.timestamp - runStartedEvent.timestamp
          : 0,
    };
  }

  /**
   * Deletes all events associated with a specific project.
   * @param {Object} params - The parameters for deletion
   * @param {string} params.projectId - The ID of the project
   * @returns {Promise<void>}
   */
  async deleteAllEventsForProject({ projectId }: { projectId: string }) {
    return await this.eventRepository.deleteAllEvents({
      projectId,
    });
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
    const scenarioRunIds =
      await this.eventRepository.getScenarioRunIdsForScenario({
        projectId,
        scenarioId,
      });

    if (scenarioRunIds.length === 0) {
      return null;
    }

    // Use batch method instead of N+1 queries
    const runs = await this.getScenarioRunDataBatch({
      projectId,
      scenarioRunIds,
    });

    return runs;
  }

  /**
   * Retrieves scenario sets data for a specific project.
   * @param {Object} params - The parameters for retrieving scenario sets
   * @param {string} params.projectId - The ID of the project
   * @returns {Promise<any>} The scenario sets data
   */
  async getScenarioSetsDataForProject({ projectId }: { projectId: string }) {
    return await this.eventRepository.getScenarioSetsDataForProject({
      projectId,
    });
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

    return {
      runs,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
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
    const batchRunIds = new Set<string>();
    let cursor: string | undefined = undefined;
    const pageLimit = 100; // repository/server cap
    const maxPages = 1000; // safety guard (100k ids) - increased from 200
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
          "Refine filters or use the paginated API."
      );
    }

    if (batchRunIds.size === 0) return [];
    return await this.getRunDataForBatchIds({
      projectId,
      batchRunIds: Array.from(batchRunIds),
    });
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
    // Get scenario run IDs for this specific batch run
    const scenarioRunIds =
      await this.eventRepository.getScenarioRunIdsForBatchRun({
        projectId,
        scenarioSetId,
        batchRunId,
      });

    if (scenarioRunIds.length === 0) return [];

    // Use batch method to get the actual run data
    const runs = await this.getScenarioRunDataBatch({
      projectId,
      scenarioRunIds,
    });

    return runs;
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
    // 2. Get scenario run IDs
    const scenarioRunIds =
      await this.eventRepository.getScenarioRunIdsForBatchRuns({
        projectId,
        batchRunIds,
      });

    if (scenarioRunIds.length === 0) return [];

    // 3. Use batch method instead of N+1 queries
    const runs = await this.getScenarioRunDataBatch({
      projectId,
      scenarioRunIds,
    });

    return runs;
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
    if (scenarioRunIds.length === 0) {
      return [];
    }

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
      if (!runStartedEvent || !messageEvent) {
        continue;
      }

      runs.push({
        scenarioId: messageEvent.scenarioId,
        batchRunId: messageEvent.batchRunId,
        scenarioRunId: messageEvent.scenarioRunId,
        status: runFinishedEvent?.status ?? ScenarioRunStatus.IN_PROGRESS,
        results: runFinishedEvent?.results ?? null,
        messages: messageEvent.messages ?? [],
        timestamp: messageEvent.timestamp ?? 0,
        name: runStartedEvent?.metadata?.name ?? null,
        description: runStartedEvent?.metadata?.description ?? null,
        durationInMs:
          runStartedEvent?.timestamp && runFinishedEvent?.timestamp
            ? Math.max(
                0,
                runFinishedEvent.timestamp - runStartedEvent.timestamp
              )
            : 0,
      });
    }

    return runs;
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
    return await this.eventRepository.getBatchRunCountForScenarioSet({
      projectId,
      scenarioSetId,
    });
  }
}
