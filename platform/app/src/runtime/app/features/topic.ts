import type { ProcessStore } from "@langwatch/eventing";
import type { TopicService } from "@langwatch/topic-contract";
import {
  PostgresTopicAdapter,
  TopicClusteringSchedulePort,
} from "@langwatch/topic-server";
import { TOPIC_CLUSTERING_PROCESS_NAME } from "~/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClusteringProcess.types";

type TopicDatabase = Parameters<typeof PostgresTopicAdapter.create>[0]["database"];

class AppTopicSchedulePort extends TopicClusteringSchedulePort {
  constructor(private readonly processStore: ProcessStore) {
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

/** Composes the process-owned Topic service and its eventing schedule read. */
export class AppTopicRuntime {
  private constructor(
    private readonly database: TopicDatabase,
    private readonly processStore: ProcessStore,
  ) {}

  static create(options: {
    database: TopicDatabase;
    processStore: ProcessStore;
  }): AppTopicRuntime {
    return new AppTopicRuntime(options.database, options.processStore);
  }

  build(): TopicService {
    return PostgresTopicAdapter.create({
      database: this.database,
      schedule: new AppTopicSchedulePort(this.processStore),
    });
  }
}
