/**
 * `github.*`, composed as its own feature rather than as a member of a group.
 *
 * The GitHub App an organization connected, the repositories it reaches and the
 * pull requests its coding agents opened. One namespace, two answers nobody
 * else owns, and no graph shared with anything beside it — so it is composed
 * here, from the shared infrastructure every feature composition is handed,
 * and named once in the application's router literal.
 *
 * The organization is derived from the project rather than taken from the
 * client: the pull-request read is project-scoped because that is how a caller
 * reaches it, and a caller naming an organization id could otherwise ask about
 * another tenant's pull requests.
 *
 * The REST half of this feature is composed the same way one file over, in
 * {@link composeApiGithubRest} — a feature owns both its doors.
 */
import type { GithubService } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
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
 *
 * A refusing directory rather than an absent one, for the reason every other
 * refusal on this migration gives: `github.*` mounts either way, and a caller
 * asking whether an organization has connected the App must be told this
 * deployment cannot answer rather than have the call disappear.
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
