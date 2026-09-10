/**
 * The topic tree a project's traces are labelled by, installed over this
 * process's own graph.
 */
import { createApp } from "@langwatch/runtime-composition";
import { type TopicClusteringScheduleReader, topicServer } from "@langwatch/topic-server";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createTopicTrpcRouter } from "./topic-trpc.mount.ts";

import type { ComposedTopicFeature } from "./topic.composition.types.ts";

/** Installs the topic read surface over this process's own connection. */
export async function installApiTopic(options: {
  /** Only the process's own connection: the topic read surface composes nothing else. */
  infrastructure: Pick<ApiTrpcInfrastructure, "prisma">;
}): Promise<ComposedTopicFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.infrastructure.prisma })
    // The next clustering wake is an eventing schedule read, and this process
    // starts no scheduler. `null` is the status panel's own "not scheduled",
    // which is what a process that never schedules should say.
    .withInfrastructure({ schedule: new UnscheduledTopicClustering() })
    .withModule(topicServer)
    .boot({ role: "api" });

  return {
    app: runtime.module(topicServer).provided,
    router: (mount) => createTopicTrpcRouter(mount.runtime),
  };
}

/** A process that never schedules clustering: the status panel reads "not scheduled". */
class UnscheduledTopicClustering implements TopicClusteringScheduleReader {
  findNextWakeAt() {
    return Promise.resolve(null);
  }
}
