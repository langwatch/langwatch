/**
 * The topic tree a project's traces are labelled by, installed over this
 * process's own graph.
 */
import { createApp } from "@langwatch/runtime-composition";
import { TopicClusteringSchedulePort, topicServer } from "@langwatch/topic-server";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createTopicTrpcRouter } from "./topic-trpc.mount.ts";

import type { ComposedTopicFeature } from "./topic.composition.types.ts";

/** Installs the topic read surface over this process's own connection. */
export async function installApiTopic(options: {
  infrastructure: ApiTrpcInfrastructure;
}): Promise<ComposedTopicFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.infrastructure.prisma })
    // The next clustering wake is an eventing schedule read, and this process
    // starts no scheduler. `null` is the status panel's own "not scheduled",
    // which is what a process that never schedules should say.
    .withInfrastructure({ schedule: new UnscheduledTopicClustering() })
    .withFeature(topicServer)
    .boot({ role: "api" });

  return {
    app: runtime.feature(topicServer).provided,
    router: (mount) => createTopicTrpcRouter(mount.runtime),
  };
}

/** A process that never schedules clustering: the status panel reads "not scheduled". */
class UnscheduledTopicClustering extends TopicClusteringSchedulePort {
  tryGetNextWakeAt() {
    return Promise.resolve(null);
  }
}
