import type { GithubRepository } from "@langwatch/github-contract";

export const GITHUB_WRITE_PERMISSIONS: Record<string, string> = {
  contents: "write",
  pull_requests: "write",
};

export const GITHUB_READ_PULL_PERMISSIONS: Record<string, string> = {
  pull_requests: "read",
};

export type GithubInstallationToken = {
  token: string;
  expiresAt: string;
  repositorySelection?: string;
};

export type GithubInstallationDetails = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
};

export type GithubPullRequestSummary = {
  number: number;
  htmlUrl: string;
  title: string;
  state: string;
  draft: boolean;
  mergedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorLogin: string | null;
};

export type MintInstallationTokenInput = {
  installationId: string;
  repositoryIds?: string[];
  permissions?: Record<string, string>;
};

export abstract class GithubAppTokenPort {
  abstract readonly configured: boolean;
  abstract getInstallation(installationId: string): Promise<GithubInstallationDetails>;
  abstract mintInstallationToken(
    input: MintInstallationTokenInput,
  ): Promise<GithubInstallationToken>;
  abstract listInstallationRepositories(
    installationId: string,
  ): Promise<GithubRepository[]>;
  abstract listPullRequestsForHead(input: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]>;
  abstract getPullRequest(input: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary>;
  abstract computeRepoScopeKey(input: {
    repositoryIds?: string[];
    permissions?: Record<string, string>;
  }): string;
}

export abstract class GithubRedisPort {
  abstract tryGet(key: string): Promise<string | null>;
  abstract trySet(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<string | null>;
  abstract delete(key: string): Promise<number>;
  abstract tryGetDelete(key: string): Promise<string | null>;
  abstract tryEval(
    script: string,
    numKeys: number,
    ...args: string[]
  ): Promise<number | string | null>;
}

export class GithubInstallationNotFoundError extends Error {
  readonly installationId: string;

  constructor(installationId: string) {
    super(`GitHub installation ${installationId} not found`);
    this.name = "GithubInstallationNotFoundError";
    this.installationId = installationId;
  }
}

export class GithubRateLimitedError extends Error {
  readonly retryAfterSec: number | null;
  readonly resetAt: Date | null;

  constructor(input: { retryAfterSec: number | null; resetAt: Date | null }) {
    super("GitHub rate limit reached");
    this.name = "GithubRateLimitedError";
    this.retryAfterSec = input.retryAfterSec;
    this.resetAt = input.resetAt;
  }
}
