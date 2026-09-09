/**
 * `github.*`, composed as its own feature rather than as a member of a group. The GitHub
 * App an organization connected, the repositories it reaches and the pull requests its
 * coding agents opened.
 */
import type { GithubApi } from "@langwatch/github-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

// `github.*` is not built here: its tRPC transport is unconverted, so this file
// keeps only the refusing `ctx.app.github` slice.

const logger = createLogger("langwatch:api:github");

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
