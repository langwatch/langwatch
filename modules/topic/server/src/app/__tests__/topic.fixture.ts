import { Temporal, type Instant } from "@langwatch/time";
import { TopicClusteringScheduleRepository } from "../../repositories/topic-clustering-schedule.repository.ts";

/** A process that schedules nothing: the status panel reads "not scheduled". */
export class UnscheduledTopicClustering extends TopicClusteringScheduleRepository {
  static create(nextWakeAt: Instant | null = null): UnscheduledTopicClustering {
    return new UnscheduledTopicClustering(nextWakeAt);
  }

  private constructor(private readonly nextWakeAt: Instant | null) {
    super();
  }

  findNextWakeAt(): Promise<Instant | null> {
    return Promise.resolve(this.nextWakeAt);
  }
}

/** The wake a status assertion pins itself to. */
export function topicTestWake(epochMilliseconds: number): Instant {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds);
}
