import { ScenarioEventRepository } from "./scenario-event.repository";
import { ScenarioRunStatus } from "./enums";
import type {
  ScenarioEvent,
  ScenarioRunData,
  ScenarioRunFinishedEvent,
} from "./types";

export class ScenarioRunnerService {
  private eventRepository: ScenarioEventRepository;

  constructor() {
    this.eventRepository = new ScenarioEventRepository();
  }

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

  async getScenarioRunIds({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    return this.eventRepository.getAllScenarioRunsForProject({
      projectId,
    });
  }

  async getAllRunEventsForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ScenarioEvent[]> {
    return await this.eventRepository.getAllRunEventsForProject({
      projectId,
    });
  }

  async deleteAllEventsForProject({ projectId }: { projectId: string }) {
    return await this.eventRepository.deleteAllEvents({
      projectId,
    });
  }

  async getAllBatchRunsForProject({ projectId }: { projectId: string }) {
    return this.eventRepository.getAllBatchRunsForProject({
      projectId,
    });
  }

  async getScenarioRunIdsForBatch({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<string[]> {
    return this.eventRepository.getScenarioRunIdsForBatch({
      projectId,
      batchRunId,
    });
  }

  async getScenarioRunDataForBatch({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }) {
    const ids = await this.eventRepository.getScenarioRunIdsForBatch({
      projectId,
      batchRunId,
    });

    const runs = await Promise.all(
      ids.map((id) => this.getScenarioRunData({ projectId, scenarioRunId: id }))
    );

    return runs.filter(Boolean) as ScenarioRunData[];
  }

  async getScenarioResultsHistory({
    projectId,
    scenarioId,
  }: {
    projectId: string;
    scenarioId: string;
  }): Promise<{
    results: ScenarioRunFinishedEvent[];
  }> {
    const events =
      await this.eventRepository.getScenarioRunFinishedEventsByScenarioId({
        projectId,
        scenarioId,
      });

    const results = events.map((event) => {
      return {
        ...event,
        results: event.results,
      };
    });

    return {
      results,
    };
  }

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

  async getScenarioSetsDataForProject({ projectId }: { projectId: string }) {
    return await this.eventRepository.getScenarioSetsDataForProject({
      projectId,
    });
  }

  // Get batch run data for a scenario set
  // TODO: This is a temporary solution as it's making a lot of queries to the database.
  async getBatchRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }) {
    // 1. Get batch run IDs
    const batchRunIds = await this.eventRepository.getBatchRunIdsForScenarioSet(
      {
        projectId,
        scenarioSetId,
      }
    );

    if (batchRunIds.length === 0) return [];

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

    return runs.filter(Boolean) as ScenarioRunData[];
  }
}
