/**
 * `github.*`, composed as its own feature rather than as a member of a group. The GitHub
 * App an organization connected, the repositories it reaches and the pull requests its
 * coding agents opened.
 */
import type { GithubService } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure";
import { createGithubTrpcRouter, type GithubTrpcMountPorts } from "./github-trpc.mount";

/** Builds `github.*` on this process's root, over this process's own graph. */
export function composeGithubTrpcRouter(options: {
  mount: ApiTrpcFeatureMount;
  infrastructure: ApiTrpcInfrastructure;
}) {
  return createGithubTrpcRouter({
    ...options.mount,
    ports: githubPorts(options.infrastructure),
  });
}

const logger = createLogger("langwatch:api:github");

function githubPorts(infrastructure: ApiTrpcInfrastructure): GithubTrpcMountPorts {
  return {
    tryResolveOrganizationForProject: async (projectId) => {
      const project = await infrastructure.prisma.project.findUnique({
        where: { id: projectId },
        select: { team: { select: { organizationId: true } } },
      });
      return project?.team.organizationId ?? undefined;
    },
    recordAudit: async (entry) => {
      await infrastructure.audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: { organizationId: entry.organizationId, ...entry.args },
        error: null,
      });
      logger.debug({ action: entry.action }, "recorded a GitHub connection command");
    },
  };
}

/** A capability this deployment did not compose, refused by name. */
class ApiCapabilityUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiCapabilityUnavailableError";
  }
}

/**
 * The `ctx.app.github` slice on a process that opened no database.
 */
export function refusingGithubService(): GithubService {
  logger.info(
    {},
    "API composed no GitHub directory: the connection status, the repositories and the pull-request reads all mount and refuse by name",
  );
  return new Proxy({} as GithubService, {
    get: () => () => {
      throw new ApiCapabilityUnavailableError(
        "GitHub App registration, so it can neither read a connection nor list a pull request",
      );
    },
    has: () => true,
  });
}
