import { ScenarioEventRepository } from "./scenario-event.repository";
import { ScenarioRunStatus } from "./enums";
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
      status: latestRunFinishedEvent?.status || ScenarioRunStatus.IN_PROGRESS,
      results: latestRunFinishedEvent?.results || null,
      messages: latestMessageEvent.messages || [],
      timestamp: latestMessageEvent.timestamp || 0,
      name: runStartedEvent?.metadata?.name || null,
      description: runStartedEvent?.metadata?.description || null,
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
   * Retrieves run data for all runs of a specific scenario.
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

    const runs = await Promise.all(
      scenarioRunIds.map((id) =>
        this.getScenarioRunData({ projectId, scenarioRunId: id })
      )
    );

    return runs.filter(Boolean) as ScenarioRunData[];
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
   * Retrieves run data for all scenarios in a scenario set.
   * Note: This is a temporary implementation that may be optimized in the future.
   * TODO: Optimize this.
   * @param {Object} params - The parameters for retrieving run data
   * @param {string} params.projectId - The ID of the project
   * @param {string} params.scenarioSetId - The ID of the scenario set
   * @returns {Promise<ScenarioRunData[]>} Array of scenario run data
   */
  async getRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }) {
    // Use provided batchRunIds or fetch them for the scenario set
    const resolvedBatchRunIds =
      await this.eventRepository.getBatchRunIdsForScenarioSet({
        projectId,
        scenarioSetId,
      });

    if (resolvedBatchRunIds.length === 0) return [];

    return await this.getRunDataForBatchIds({
      projectId,
      batchRunIds: resolvedBatchRunIds,
    });
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

    // 3. Get and compose the data using existing service method
    const runs = await Promise.all(
      scenarioRunIds.map((id) =>
        this.getScenarioRunData({ projectId, scenarioRunId: id })
      )
    );

    return runs
      .filter(Boolean)
      .sort((a, b) => a!.timestamp - b!.timestamp) as ScenarioRunData[];
  }
}
