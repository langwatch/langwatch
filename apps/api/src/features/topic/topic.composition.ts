/**
 * The topic tree a project's traces are labelled by, composed as its own
 * feature.
 *
 * `topics.*` takes no ports — every answer is read off `ctx.app.topics` — so
 * what this composition supplies is the READER behind that slice, which the
 * trace grid's own topic-count labels share. Two readers would be two answers
 * to what a project's topics are, and the one that drifts is always the copy.
 */
import { HandledError } from "@langwatch/handled-error";
import type { TopicService } from "@langwatch/topic-contract";
import { PostgresTopicAdapter, TopicClusteringSchedulePort } from "@langwatch/topic-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createTopicTrpcRouter } from "./topic-trpc.mount";

/** The one namespace and the reader `ctx.app.topics` carries. */
export type ComposedTopicFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createTopicTrpcRouter>;
  /** For `ctx.app.topics` — the same reader the trace grid labels rows with. */
  service: TopicService;
}>;

/** Composes the topic tree over this process's own connection. */
export function composeTopicFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
}): ComposedTopicFeature {
  const service = PostgresTopicAdapter.create({
    database: options.infrastructure.prisma,
    // The next clustering wake is an eventing schedule read, and this process
    // starts no scheduler. `null` is the status panel's own "not scheduled",
    // which is what a process that never schedules should say.
    schedule: new UnscheduledTopicClustering(),
  });

  return { service, router: (mount) => createTopicTrpcRouter(mount) };
}

/**
 * The topic tree on a process that composed no database.
 *
 * The namespace still mounts and every call refuses by name, so the topics page
 * says the deployment cannot answer rather than reporting a project with no
 * topics, which reads as "clustering found nothing".
 */
export function refusingTopicFeature(): ComposedTopicFeature {
  const service = new Proxy(
    {},
    {
      get:
        () =>
        (): never => {
          throw new ApiTopicUnavailableError("The topic tree");
        },
      has: () => true,
    },
  ) as TopicService;

  return { service, router: (mount) => createTopicTrpcRouter(mount) };
}

/** A process that never schedules clustering: the status panel reads "not scheduled". */
class UnscheduledTopicClustering extends TopicClusteringSchedulePort {
  tryGetNextWakeAt(): Promise<Date | null> {
    return Promise.resolve(null);
  }
}

/** A capability this deployment did not compose, refused by name. */
class ApiTopicUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiTopicUnavailableError";
  }
}
