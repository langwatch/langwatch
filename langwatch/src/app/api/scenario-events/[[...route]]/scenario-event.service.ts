import { ScenarioEventRepository } from "./scenario-event.repository";
import { ScenarioRunStatus, type ScenarioEvent } from "./schemas";

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

  async getScenarioRunState({
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

    // Get latest run finished event using dedicated repository method
    const latestRunFinishedEvent =
      await this.eventRepository.getLatestRunFinishedEventByScenarioRunId({
        projectId,
        scenarioRunId,
      });

    return {
      messages: latestMessageEvent?.messages || [],
      status: latestRunFinishedEvent?.status || ScenarioRunStatus.IN_PROGRESS,
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
}
