/**
 * `github.*`, composed as its own feature rather than as a member of a group. The GitHub
 * App an organization connected, the repositories it reaches and the pull requests its
 * coding agents opened.
 */
import type { GithubApi } from "@langwatch/github-contract";
import { githubTrpcTransport } from "@langwatch/github-server";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";

const logger = createLogger("langwatch:api:github");

/** Builds `github.*` on this process's root, over this process's own graph. */
export function composeGithubTrpcRouter(options: {
  mount: ApiTrpcFeatureMount;
  infrastructure: ApiTrpcInfrastructure;
}) {
  const { infrastructure } = options;

  return options.mount.runtime.mount(githubTrpcTransport, (ctx) => ({
    github: (): GithubApi => ctx.app.github,
    // The organization is derived from the project through the coding-agent
    // directory, which is the one application that already answers it, so the
    // live pull-request read and its linkage cannot disagree about the tenant.
    findOrganizationForProject: (projectId) =>
      ctx.app.codingAgentApp.findOrganizationForProject(projectId),
    recordAudit: async (entry) => {
      await infrastructure.audit?.record({
        actorId: entry.userId,
        path: entry.action,
        input: { organizationId: entry.organizationId, ...entry.args },
        error: null,
      });
      logger.debug({ action: entry.action }, "recorded a GitHub connection command");
    },
  }));
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
export function refusingGithubService(): GithubApi {
  logger.info(
    {},
    "API composed no GitHub directory: the connection status, the repositories and the pull-request reads all mount and refuse by name",
  );
  return new Proxy({} as GithubApi, {
    get: () => () => {
      throw new ApiCapabilityUnavailableError(
        "GitHub App registration, so it can neither read a connection nor list a pull request",
      );
    },
    has: () => true,
  });
}
