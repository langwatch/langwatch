/**
 * The links a project shares outside itself, composed as their own feature. `share.*`
 * administers the links; `pinnedTrace.*` is the same ledger read as the traces a person
 * kept.
 */
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ProjectService } from "@langwatch/project-contract";
import type { ShareService } from "@langwatch/share-contract";
import { PostgresShareAdapter } from "@langwatch/share-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure";
import { createPinnedTraceTrpcRouter, createShareTrpcRouter } from "./share-trpc.mount";

/** The other features' services a share link is bounded and authorized by. */
export type SharePeers = Readonly<{
  /** The window a shared trace stays readable inside. */
  dataRetention: DataRetentionService;
  /** Resolves a project's organization, team and department. */
  projects: ProjectService;
  /** Emits the authorization grants a share hands its viewer. */
  grants: AuthzGrantsService;
}>;

/** The two namespaces and the service `ctx.app.share` carries. */
export type ComposedShareFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    share: ReturnType<typeof createShareTrpcRouter>;
    pinnedTrace: ReturnType<typeof createPinnedTraceTrpcRouter>;
  };
  /** For `ctx.app.share` — the one ledger every share door reads. */
  service: ShareService;
}>;

/** Composes the share ledger over this process's own graph. */
export function composeShareFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: SharePeers;
  /** The viewer cache; `null` runs the ledger uncached. */
  redis: Parameters<typeof PostgresShareAdapter.create>[0]["redis"];
}): ComposedShareFeature {
  const service = PostgresShareAdapter.create({
    database: options.infrastructure.prisma,
    dataRetention: options.peers.dataRetention,
    projects: options.peers.projects,
    permissions: options.infrastructure.authz,
    grants: options.peers.grants,
    redis: options.redis,
  });

  return { service, routers: mountRouters };
}

/**
 * The share surfaces on a process that composed no database. Both namespaces still mount
 * and every call refuses by name, so the settings form says the deployment cannot answer
 * rather than reporting that a project has shared nothing.
 */
export function refusingShareFeature(): ComposedShareFeature {
  const service = new Proxy(
    {},
    {
      get: () => (): never => {
        throw new ApiShareUnavailableError("Sharing");
      },
      has: () => true,
    },
  ) as ShareService;

  return { service, routers: mountRouters };
}

/**
 * Both routers, over the mount alone. Neither takes ports: every answer is read off
 * `ctx.app.share`, which is the service above — so a refusing composition and a real one
 * mount the same two namespaces and differ only in what the slice answers.
 */
function mountRouters(mount: ApiTrpcFeatureMount) {
  return {
    share: createShareTrpcRouter(mount),
    pinnedTrace: createPinnedTraceTrpcRouter(mount),
  };
}

/** A capability this deployment did not compose, refused by name. */
class ApiShareUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiShareUnavailableError";
  }
}
