import type { ProcessStore } from "@langwatch/eventing";
import type { GithubApi } from "@langwatch/github-contract";
import { defineServerModule } from "@langwatch/kernel";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import {
  GithubApp,
  type GithubComposition,
  type GithubBranchMaintenanceComposition,
  type GithubBranchDemandComposition,
} from "./app/github.app.ts";
import type { GithubBranchMaintenance, GithubBranchDemand } from "./app/github.members.ts";
import { githubMaintenanceEventing } from "./eventing/github-maintenance.pipeline.ts";
import { githubRepositories } from "./repositories/github-repositories.registry.ts";
import type { GithubRepositories } from "./repositories/github.repositories.ts";
import {
  PrismaGithubInstallationsRepository,
  type PrismaGithubInstallationsDatabase,
} from "./repositories/prisma/prisma.github-installations.repository.ts";
import {
  PrismaGithubPullRequestsRepository,
  type PrismaGithubPullRequestsDatabase,
} from "./repositories/prisma/prisma.github-pull-requests.repository.ts";
import { GithubInstallNonceRedisRepository } from "./repositories/redis/redis.github-install-nonce.repository.ts";
import { GithubPullRequestStatusCacheRedisRepository } from "./repositories/redis/redis.github-pull-request-status-cache.repository.ts";
import { GithubTokenCacheRedisRepository } from "./repositories/redis/redis.github-token-cache.repository.ts";
import { EventingGithubMaintenanceAdapter } from "./services/github-maintenance.service.ts";
import { githubInstallRest } from "./transport/github-install.rest.ts";
import { githubTrpcTransport } from "./transport/github.trpc.ts";

export type { GithubInfrastructure } from "./app/github.app.ts";

export const githubServer = defineServerModule("github")
  .withRepositories(githubRepositories)
  .withApp(GithubApp)
  .withTransports(githubInstallRest, githubTrpcTransport)
  .withEventing(githubMaintenanceEventing);

/** The stores every ad-hoc GitHub composition below needs: a Prisma client and the Redis. */
type GithubStoreConnections = {
  prisma: PrismaGithubInstallationsDatabase & PrismaGithubPullRequestsDatabase;
  redis: ProcessMembers["redis"];
};

function buildGithubRepositories({ prisma, redis }: GithubStoreConnections): GithubRepositories {
  return {
    installations: PrismaGithubInstallationsRepository.create(prisma),
    pullRequests: PrismaGithubPullRequestsRepository.create(prisma),
    installNonces: GithubInstallNonceRedisRepository.create(redis),
    pullRequestStatusCache: GithubPullRequestStatusCacheRedisRepository.create(redis),
    tokenCache: GithubTokenCacheRedisRepository.create(redis),
  };
}

/** The whole GitHub capability, composed from the process's own Prisma client. */
export function composeGithubApi(
  parts: Omit<GithubComposition, "repositories"> & GithubStoreConnections,
): GithubApi {
  const { prisma, redis, ...rest } = parts;

  return GithubApp.composeApi({
    ...rest,
    repositories: buildGithubRepositories({ prisma, redis }),
  });
}

/** The fleet-wide branch sweep alone, composed from the process's own Prisma client. */
export function composeGithubBranchMaintenance(
  parts: Omit<GithubBranchMaintenanceComposition, "repositories"> & GithubStoreConnections,
): GithubBranchMaintenance {
  const { prisma, redis, ...rest } = parts;

  return GithubApp.composeBranchMaintenance({
    ...rest,
    repositories: buildGithubRepositories({ prisma, redis }),
  });
}

/** The demand half of pull-request linkage alone, composed the same way. */
export function composeGithubBranchDemand(
  parts: Omit<GithubBranchDemandComposition, "repositories"> & GithubStoreConnections,
): GithubBranchDemand {
  const { prisma, redis, ...rest } = parts;

  return GithubApp.composeBranchDemand({
    ...rest,
    repositories: buildGithubRepositories({ prisma, redis }),
  });
}

/**
 * The worker's registration pipeline for GitHub pull-request linkage
 * maintenance, over its own process store.
 */
export function createGithubMaintenancePipeline(deps: {
  github: GithubBranchMaintenance;
  processStore: ProcessStore;
}): ReturnType<ReturnType<typeof EventingGithubMaintenanceAdapter.create>["build"]> {
  return EventingGithubMaintenanceAdapter.create(deps).build();
}
