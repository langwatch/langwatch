import type { ProcessStore } from "@langwatch/eventing";
import { TOPIC_CLUSTERING_PROCESS_NAME } from "../processes/topic-clustering.process.ts";
import { Temporal, type Instant } from "@langwatch/time";
import { TopicClusteringScheduleRepository } from "../repositories/topic-clustering-schedule.repository.ts";

/** Reads Topic's durable wake from the generic process-manager store. */
export class EventingTopicClusteringScheduleAdapter extends TopicClusteringScheduleRepository {
  static create(options: { processStore: ProcessStore }): EventingTopicClusteringScheduleAdapter {
    return new EventingTopicClusteringScheduleAdapter(options.processStore);
  }

  private constructor(private readonly processStore: ProcessStore) {
    super();
  }

  async findNextWakeAt(input: { projectId: string }): Promise<Instant | null> {
    const instance = await this.processStore.findByRef({
      ref: {
        processName: TOPIC_CLUSTERING_PROCESS_NAME,
        projectId: input.projectId,
        processKey: input.projectId,
      },
    });
    if (!instance || instance.nextWakeAt === null) return null;
    return Temporal.Instant.fromEpochMilliseconds(instance.nextWakeAt);
  }
}
