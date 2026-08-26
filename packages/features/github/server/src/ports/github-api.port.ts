import type { GithubRepository } from "@langwatch/github-contract";

import type {
  GithubInstallationDetails,
  GithubInstallationToken,
  GithubPullRequestSummary,
  MintInstallationTokenInput,
} from "./github-app-token.port";

export abstract class GithubApiPort {
  abstract readonly configured: boolean;
  abstract signAppJwt(nowSec?: number): string;
  abstract getInstallation(installationId: string): Promise<GithubInstallationDetails>;
  abstract mintInstallationToken(
    input: MintInstallationTokenInput,
  ): Promise<GithubInstallationToken>;
  abstract listInstallationRepositories(token: string): Promise<GithubRepository[]>;
  abstract listPullRequestsForHead(input: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]>;
  abstract getPullRequest(input: {
    token: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary>;
}
