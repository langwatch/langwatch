import { HandledError, NotFoundError } from "@langwatch/handled-error";

export class GithubNotConnectedError extends NotFoundError {
  declare readonly code: "github_not_connected";

  constructor(organizationId: string) {
    super("github_not_connected", "GitHub connection", organizationId);
  }
}

export class GithubPullRequestNotMappedError extends NotFoundError {
  declare readonly code: "github_pr_not_mapped";

  constructor(input: { repositoryFullName: string; prNumber: number }) {
    super("github_pr_not_mapped", "pull request", `${input.repositoryFullName}#${input.prNumber}`);
  }
}

export class GithubInstallationConflictError extends Error {
  readonly installationId: string;
  readonly existingOrganizationId: string;
  readonly attemptedOrganizationId: string;

  constructor(input: {
    installationId: string;
    existingOrganizationId: string;
    attemptedOrganizationId: string;
  }) {
    super(
      `GitHub installation ${input.installationId} is already connected to a different organization`,
    );
    this.installationId = input.installationId;
    this.existingOrganizationId = input.existingOrganizationId;
    this.attemptedOrganizationId = input.attemptedOrganizationId;
  }
}

export class GithubInstallationSuspendedError extends HandledError {
  declare readonly code: "github_installation_suspended";

  constructor(input: { accountLogin: string }, options: { reasons?: readonly Error[] } = {}) {
    super("github_installation_suspended", "The GitHub installation is suspended.", {
      meta: { accountLogin: input.accountLogin },
      httpStatus: 409,
      ...options,
    });
    this.name = "GithubInstallationSuspendedError";
  }
}

export class GithubRepositoryNotAccessibleError extends HandledError {
  declare readonly code: "github_repo_not_accessible";

  constructor(input: { repositoryFullName: string }, options: { reasons?: readonly Error[] } = {}) {
    super("github_repo_not_accessible", "The GitHub App cannot reach that repository.", {
      meta: { repositoryFullName: input.repositoryFullName },
      httpStatus: 403,
      ...options,
    });
    this.name = "GithubRepositoryNotAccessibleError";
  }
}

export class GithubApiRateLimitedError extends HandledError {
  declare readonly code: "github_rate_limited";

  constructor(
    input: { retryAfterSec: number | null } = { retryAfterSec: null },
    options: { reasons?: readonly Error[] } = {},
  ) {
    const meta = input.retryAfterSec === null ? {} : { retryAfterSec: input.retryAfterSec };
    super("github_rate_limited", "GitHub is rate limiting requests.", {
      meta,
      httpStatus: 429,
      fault: "provider",
      ...options,
    });
    this.name = "GithubApiRateLimitedError";
  }
}

/**
 * A setup callback claimed an installation that the flow did not create.
 *
 * The signed state proves who started an installation and for which
 * organization; it cannot carry the installation id, because GitHub only mints
 * one after the operator confirms. What the platform can insist on is that an
 * unclaimed installation being bound to an organization was created by the flow
 * that is binding it — an older installation belongs to whoever installed it.
 */
export class GithubInstallationNotFromFlowError extends Error {
  readonly installationId: string;
  readonly attemptedOrganizationId: string;

  constructor(input: { installationId: string; attemptedOrganizationId: string }) {
    super(
      `GitHub installation ${input.installationId} was not created by the installation flow claiming it`,
    );
    this.installationId = input.installationId;
    this.attemptedOrganizationId = input.attemptedOrganizationId;
    this.name = "GithubInstallationNotFromFlowError";
  }
}
