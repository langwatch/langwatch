/**
 * The strip of things a person recently touched, composed as its own feature. `home.*` is
 * one read: the entities this person last opened, across every vertical that records one.
 */
import { HandledError } from "@langwatch/handled-error";
import {
  PrismaRecentItemsRepository,
  RecentItemsService,
  type ProjectHomeApi,
} from "@langwatch/project-server";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createHomeTrpcRouter } from "./project-trpc.mount.ts";

import type { ComposedHomeFeature } from "./home.composition.types.ts";

/** Composes the recent-items strip over this process's own connection. */
export function composeHomeFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
}): ComposedHomeFeature {
  const recentItems = RecentItemsService.create({
    repository: PrismaRecentItemsRepository.create({ prisma: options.infrastructure.prisma }),
  });

  return {
    router: (mount) =>
      createHomeTrpcRouter(mount.runtime, {
        getRecentItems: (input) => recentItems.getRecentItems(input),
      }),
  };
}

/**
 * The strip on a process with no connection to walk. The namespace still mounts and the
 * read refuses by name rather than answering an empty strip, which a person would read as
 * "you have opened nothing".
 */
export function refusingHomeFeature(): ComposedHomeFeature {
  const refusing: ProjectHomeApi = {
    getRecentItems: () => Promise.reject(new ApiHomeUnavailableError()),
  };

  return { router: (mount) => createHomeTrpcRouter(mount.runtime, refusing) };
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
