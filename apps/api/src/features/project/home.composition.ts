/**
 * The strip of things a person recently touched, composed as its own feature.
 *
 * `home.*` is one read: the entities this person last opened, across every
 * vertical that records one.
 *
 * ## Why it answers off the connection rather than through a service
 *
 * The strip walks this process's own audit trail and then hydrates each entity
 * it finds there — a prompt, a dataset, a workflow, a scenario, a monitor. Five
 * verticals' rows behind one read is nobody's service but the application's, so
 * the recent-items adapter reads them together rather than fanning out across
 * five packages that would each answer a different question.
 */
import { HandledError } from "@langwatch/handled-error";
import {
  PostgresRecentItemsAdapter,
  type HomeTrpcPorts,
  type RecentItem,
} from "@langwatch/project-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createHomeTrpcRouter } from "./project-trpc.mount";

/** The one namespace this feature mounts. */
export type ComposedHomeFeature = Readonly<{
  router(mount: ApiTrpcFeatureMount): ReturnType<typeof createHomeTrpcRouter>;
}>;

/** Composes the recent-items strip over this process's own connection. */
export function composeHomeFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
}): ComposedHomeFeature {
  const recentItems = PostgresRecentItemsAdapter.create({
    database: options.infrastructure.prisma,
  }).build();

  const ports: HomeTrpcPorts = {
    getRecentItems: (
      _ctx,
      input: Readonly<{ userId: string; projectId: string; limit: number }>,
    ): Promise<RecentItem[]> => recentItems.getRecentItems(input),
  };

  return { router: (mount) => createHomeTrpcRouter({ ...mount, ports }) };
}

/**
 * The strip on a process with no connection to walk.
 *
 * The namespace still mounts and the read refuses by name rather than answering
 * an empty strip, which a person would read as "you have opened nothing".
 */
export function refusingHomeFeature(): ComposedHomeFeature {
  return {
    router: (mount) =>
      createHomeTrpcRouter({
        ...mount,
        ports: {
          getRecentItems: () => {
            throw new ApiHomeUnavailableError();
          },
        } as HomeTrpcPorts,
      }),
  };
}

/** The recent-items strip reached on a process that composed no connection. */
class ApiHomeUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "The recent-items strip is not available on this deployment.", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiHomeUnavailableError";
  }
}
