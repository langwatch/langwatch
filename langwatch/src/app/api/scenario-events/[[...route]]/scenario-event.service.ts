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
  }) {
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
      timestamp: latestMessageEvent.timestamp,
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
}
