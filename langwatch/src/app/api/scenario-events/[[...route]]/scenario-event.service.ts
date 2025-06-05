import { ScenarioEventRepository } from "./scenario-event.repository";
import { ScenarioRunStatus } from "./enums";
import type { ScenarioEvent, ScenarioRunFinishedEvent } from "./types";

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

  async getScenarioRunsForBatch({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<string[]> {
    return this.eventRepository.getScenarioRunsForBatch({
      projectId,
      batchRunId,
    });
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
}
