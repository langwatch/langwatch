/**
 * Handled errors for the organization's GitHub connection.
 *
 * Each one names a failure a customer can act on: connect GitHub, unsuspend the
 * installation on GitHub, grant the App access to a repository, or wait out a
 * rate limit. Everything else GitHub or the database can do to us stays a plain
 * `Error` and degrades to "unknown" at the boundary, with the trace id, per
 * ADR-045.
 *
 * Copy lives in features/errors/logic/presentation.ts, keyed by code; these
 * messages are the server-side, customer-safe sentence the REST boundary ships.
 */
import { HandledError, NotFoundError } from "@langwatch/handled-error";

/**
 * The organization has no GitHub connection to work with, either because none
 * was ever made or because the one being addressed is gone (uninstalled on
 * GitHub, then reaped by the webhook).
 */
export class GithubNotConnectedError extends NotFoundError {
  declare readonly code: "github_not_connected";

  constructor(
    organizationId: string,
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("github_not_connected", "GitHub connection", organizationId, options);
    this.name = "GithubNotConnectedError";
  }
}

/**
 * GitHub has suspended the installation, so no token can be minted against it.
 * Only a human on github.com can lift a suspension, which is why this is not a
 * retry.
 */
export class GithubInstallationSuspendedError extends HandledError {
  declare readonly code: "github_installation_suspended";

  constructor(
    { accountLogin }: { accountLogin: string },
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "github_installation_suspended",
      "The GitHub installation is suspended.",
      {
        meta: { accountLogin },
        httpStatus: 409,
        ...options,
      },
    );
    this.name = "GithubInstallationSuspendedError";
  }
}

/**
 * The App is installed, but not on the repository being asked about. The
 * remedy is on GitHub's side (add the repository to the installation), so this
 * is the customer's to act on rather than ours.
 */
export class GithubRepositoryNotAccessibleError extends HandledError {
  declare readonly code: "github_repo_not_accessible";

  constructor(
    { repositoryFullName }: { repositoryFullName: string },
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "github_repo_not_accessible",
      "The GitHub App cannot reach that repository.",
      {
        meta: { repositoryFullName },
        httpStatus: 403,
        ...options,
      },
    );
    this.name = "GithubRepositoryNotAccessibleError";
  }
}

/**
 * The pull request the caller asked about has no mapping: either no
 * installation covers its repository, or the branch has not been looked up
 * yet. Both are things the customer can act on, one by connecting the
 * repository and the other by waiting, which is why this is named rather than
 * left to degrade into "unknown".
 */
export class GithubPullRequestNotMappedError extends NotFoundError {
  declare readonly code: "github_pr_not_mapped";

  constructor(
    {
      repositoryFullName,
      prNumber,
    }: { repositoryFullName: string; prNumber: number },
    options: { reasons?: readonly Error[] } = {},
  ) {
    super(
      "github_pr_not_mapped",
      "pull request",
      `${repositoryFullName}#${prNumber}`,
      options,
    );
    this.name = "GithubPullRequestNotMappedError";
  }
}

/**
 * GitHub is rate limiting us. The transport-level fact is
 * `GithubRateLimitedError` in githubAppToken.ts; this is the customer-facing
 * half, raised only where a person is waiting on the answer. `fault` is the
 * provider's: the customer did nothing wrong and neither did we, and a 429 that
 * logged as a customer mistake would hide a real capacity problem.
 */
export class GithubApiRateLimitedError extends HandledError {
  declare readonly code: "github_rate_limited";

  constructor(
    { retryAfterSec }: { retryAfterSec: number | null } = {
      retryAfterSec: null,
    },
    options: { reasons?: readonly Error[] } = {},
  ) {
    super("github_rate_limited", "GitHub is rate limiting requests.", {
      meta: retryAfterSec != null ? { retryAfterSec } : {},
      httpStatus: 429,
      fault: "provider",
      ...options,
    });
    this.name = "GithubApiRateLimitedError";
  }
}
