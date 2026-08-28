import type { ProcessStore } from "@langwatch/eventing";
import { TOPIC_CLUSTERING_PROCESS_NAME } from "../processes/topic-clustering.process";
import { TopicClusteringSchedulePort } from "../ports/topic-clustering-schedule.port";

/** Reads Topic's durable wake from the generic process-manager store. */
export class EventingTopicClusteringScheduleAdapter extends TopicClusteringSchedulePort {
  static create(options: { processStore: ProcessStore }): EventingTopicClusteringScheduleAdapter {
    return new EventingTopicClusteringScheduleAdapter(options.processStore);
  }

  private constructor(private readonly processStore: ProcessStore) {
    super();
  }

  async tryGetNextWakeAt(input: { projectId: string }): Promise<Date | null> {
    const instance = await this.processStore.findByRef({
      ref: {
        processName: TOPIC_CLUSTERING_PROCESS_NAME,
        projectId: input.projectId,
        processKey: input.projectId,
      },
    });
    if (!instance || instance.nextWakeAt === null) return null;
    return new Date(instance.nextWakeAt);
  }
}
