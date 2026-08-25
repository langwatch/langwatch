/** Eventing-owned schedule read needed by the Topic status projection. */
export abstract class TopicClusteringSchedulePort {
  abstract tryGetNextWakeAt(input: {
    projectId: string;
  }): Promise<Date | null>;
}
