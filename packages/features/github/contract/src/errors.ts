import { NotFoundError } from "@langwatch/handled-error";

export class GithubNotConnectedError extends NotFoundError {
  declare readonly code: "github_not_connected";

  constructor(organizationId: string) {
    super("github_not_connected", "GitHub connection", organizationId);
  }
}

export class GithubPullRequestNotMappedError extends NotFoundError {
  declare readonly code: "github_pr_not_mapped";

  constructor(input: { repositoryFullName: string; prNumber: number }) {
    super(
      "github_pr_not_mapped",
      "pull request",
      `${input.repositoryFullName}#${input.prNumber}`,
    );
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
