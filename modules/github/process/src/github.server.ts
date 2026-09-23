import type { ProcessStore } from "@langwatch/eventing";
import type { GithubApi } from "@langwatch/github-contract";
import { defineServerModule } from "@langwatch/kernel";

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
import { EventingGithubMaintenanceAdapter } from "./services/github-maintenance.service.ts";
import { githubInstallRest } from "./transport/github-install.rest.ts";
import { githubTrpcTransport } from "./transport/github.trpc.ts";

export type { GithubInfrastructure } from "./app/github.app.ts";

export const githubServer = defineServerModule("github")
  .withRepositories(githubRepositories)
  .withApp(GithubApp)
  .withTransports(githubInstallRest, githubTrpcTransport)
  .withEventing(githubMaintenanceEventing);

/** The rows every ad-hoc GitHub composition below needs, from one Prisma client. */
type GithubPrismaConnection = PrismaGithubInstallationsDatabase & PrismaGithubPullRequestsDatabase;

function buildGithubRepositories(prisma: GithubPrismaConnection): GithubRepositories {
  return {
    installations: PrismaGithubInstallationsRepository.create(prisma),
    pullRequests: PrismaGithubPullRequestsRepository.create(prisma),
  };
}

/** The whole GitHub capability, composed from the process's own Prisma client. */
export function composeGithubApi(
  parts: Omit<GithubComposition, "repositories"> & { prisma: GithubPrismaConnection },
): GithubApi {
  const { prisma, ...rest } = parts;

  return GithubApp.composeApi({ ...rest, repositories: buildGithubRepositories(prisma) });
}

/** The fleet-wide branch sweep alone, composed from the process's own Prisma client. */
export function composeGithubBranchMaintenance(
  parts: Omit<GithubBranchMaintenanceComposition, "repositories"> & {
    prisma: GithubPrismaConnection;
  },
): GithubBranchMaintenance {
  const { prisma, ...rest } = parts;

  return GithubApp.composeBranchMaintenance({
    ...rest,
    repositories: buildGithubRepositories(prisma),
  });
}

/** The demand half of pull-request linkage alone, composed the same way. */
export function composeGithubBranchDemand(
  parts: Omit<GithubBranchDemandComposition, "repositories"> & { prisma: GithubPrismaConnection },
): GithubBranchDemand {
  const { prisma, ...rest } = parts;

  return GithubApp.composeBranchDemand({ ...rest, repositories: buildGithubRepositories(prisma) });
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
