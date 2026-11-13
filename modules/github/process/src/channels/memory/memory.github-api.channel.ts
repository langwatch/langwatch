import type { GithubRepository } from "@langwatch/github-contract";
import { GithubRepositoryNotAccessibleError } from "@langwatch/github-contract";
import { nowInstant } from "@langwatch/time";

import type {
  GithubAppClient,
  GithubCheckRunSummary,
  GithubCheckSuiteSummary,
  GithubInstallationDetails,
  GithubInstallationToken,
  GithubPullRequestSummary,
  MintInstallationTokenInput,
} from "../../app/github.app.ts";
import { GithubInstallationNotFoundError } from "../github-api.channel.ts";

type MemoryGithubInstallation = Omit<GithubInstallationDetails, "permissions"> & {
  permissions?: Record<string, string>;
};
type MemoryCommitChecks = { suites: GithubCheckSuiteSummary[]; runs: GithubCheckRunSummary[] };
type MemoryGithubPullRequest = GithubPullRequestSummary & { owner: string; repo: string };

/**
 * The raw GitHub App client, in memory: installations and pull requests come
 * from what the test seeded, and an installation nothing seeded refuses the
 * same way GitHub's 404 does. No network, no signed JWT, no rate limiting.
 */
export class MemoryGithubApiAdapter implements GithubAppClient {
  private readonly installations = new Map<string, MemoryGithubInstallation>();
  private readonly pullRequests: MemoryGithubPullRequest[] = [];
  private readonly commitChecks = new Map<string, MemoryCommitChecks>();
  private readonly refusedCommits = new Set<string>();
  /** Every mint asked of this client, in order, so a test can read what was asked for. */
  readonly mints: MintInstallationTokenInput[] = [];

  private constructor(private readonly appConfigured: boolean) {}

  static create(options: { configured?: boolean } = {}): MemoryGithubApiAdapter {
    return new MemoryGithubApiAdapter(options.configured ?? true);
  }

  /** States one installation a test's `getInstallation`/token mint should find. */
  seedInstallation(installation: MemoryGithubInstallation): void {
    this.installations.set(installation.installationId, installation);
  }

  /** States one pull request `listPullRequestsForHead`/`getPullRequest` should find. */
  seedPullRequest(pullRequest: MemoryGithubPullRequest): void {
    this.pullRequests.push(pullRequest);
  }

  /** States the check suites and runs GitHub lists for one commit. */
  seedCommitChecks(input: { owner: string; repo: string; sha: string } & MemoryCommitChecks): void {
    this.commitChecks.set(commitKey(input), { suites: input.suites, runs: input.runs });
  }

  /** Makes listing one commit's checks fail the way a GitHub error would. */
  refuseCommitChecks(input: { owner: string; repo: string; sha: string }): void {
    this.refusedCommits.add(commitKey(input));
  }

  get configured(): boolean {
    return this.appConfigured;
  }

  signAppJwt(): string {
    return "memory-app-jwt";
  }

  async getInstallation(installationId: string): Promise<GithubInstallationDetails> {
    const installation = this.installations.get(installationId);
    if (!installation) throw new GithubInstallationNotFoundError(installationId);

    return { ...installation, permissions: installation.permissions ?? {} };
  }

  async mintInstallationToken(input: MintInstallationTokenInput): Promise<GithubInstallationToken> {
    this.mints.push(input);
    if (!this.installations.has(input.installationId)) {
      throw new GithubInstallationNotFoundError(input.installationId);
    }

    return {
      token: `memory-token-${input.installationId}`,
      expiresAt: nowInstant().add({ hours: 1 }).toString(),
    };
  }

  async listInstallationRepositories(): Promise<GithubRepository[]> {
    return [];
  }

  async listPullRequestsForHead(input: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]> {
    return this.pullRequests.filter(
      (pullRequest) => pullRequest.owner === input.owner && pullRequest.repo === input.repo,
    );
  }

  async getPullRequest(input: {
    token: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary> {
    const pullRequest = this.pullRequests.find(
      (candidate) =>
        candidate.owner === input.owner &&
        candidate.repo === input.repo &&
        candidate.number === input.number,
    );
    if (!pullRequest) {
      throw new GithubRepositoryNotAccessibleError({
        repositoryFullName: `${input.owner}/${input.repo}`,
      });
    }

    return pullRequest;
  }

  async listCommitCheckSuites(input: {
    token: string;
    owner: string;
    repo: string;
    sha: string;
  }): Promise<GithubCheckSuiteSummary[]> {
    return this.readCommit(input).suites;
  }

  async listCommitCheckRuns(input: {
    token: string;
    owner: string;
    repo: string;
    sha: string;
  }): Promise<GithubCheckRunSummary[]> {
    return this.readCommit(input).runs;
  }

  private readCommit(input: { owner: string; repo: string; sha: string }): MemoryCommitChecks {
    if (this.refusedCommits.has(commitKey(input))) {
      throw new Error("GitHub repository read failed: 500");
    }
    return this.commitChecks.get(commitKey(input)) ?? { suites: [], runs: [] };
  }
}

function commitKey(input: { owner: string; repo: string; sha: string }): string {
  return `${input.owner}/${input.repo}@${input.sha}`.toLowerCase();
}
