import { AGUIEventRepository } from "./ag-ui-event.repository";
import type { CustomEvent } from "@ag-ui/core";

export class ScenarioRunnerService {
  private eventRepository: AGUIEventRepository;

  constructor() {
    this.eventRepository = new AGUIEventRepository();
  }

  async getScenarioState({
    threadId,
    projectId,
  }: {
    threadId: string;
    projectId: string;
  }) {
    // Get latest message snapshot event using dedicated repository method
    const latestMessageEvent =
      await this.eventRepository.getLatestMessagesSnapshotEvent({
        projectId,
        threadId,
      });

    // Get latest custom event with status using dedicated repository method
    const latestCustomEvent = await this.getLatestScenarioFinishedEvent({
      projectId,
      threadId,
    });

    console.log({
      threadId,
      projectId,
      latestMessageEvent,
      latestCustomEvent,
    });

    return {
      messages: latestMessageEvent?.messages || [],
      status: latestCustomEvent?.value?.status || "in-progress",
    };
  }

  private async getLatestScenarioFinishedEvent({
    projectId,
    threadId,
  }: {
    projectId: string;
    threadId: string;
  }): Promise<CustomEvent & { value: { status: string } }> {
    return (await this.eventRepository.getLatestCustomEventByName({
      projectId,
      threadId,
      name: "SCENARIO_FINISHED",
    })) as CustomEvent & { value: { status: string } };
  }
}
