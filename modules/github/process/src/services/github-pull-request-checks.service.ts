/**
 * Turns GitHub's check_suite announcements on agent branches into one fact per commit, once
 * every check on that commit finished.
 * Spec: modules/github/specs/github-pull-request-checks.feature
 */
import { createLogger } from "@langwatch/observability";

import type { GithubAppTokenCache } from "../app/github.app.ts";
import {
  judgeCommitChecks,
  type GithubAgentCheckSuiteCompleted,
} from "../rules/github-check-suite-event.rules.ts";
import type { GithubHost } from "../rules/github-host.rules.ts";
import type { GithubInstallationLookup } from "./github-installation-access.service.ts";
import type { GithubInstallationFactsService } from "./github-installation-facts.service.ts";

const logger = createLogger("langwatch:github:pull-request-checks");

type GithubPullRequestChecksDependencies = Readonly<{
  installations: Pick<GithubInstallationLookup, "findByInstallationId">;
  appTokens: Pick<GithubAppTokenCache, "readCommitChecks" | "getPullRequest">;
  facts: Pick<GithubInstallationFactsService, "recordPullRequestChecksCompleted">;
  host: GithubHost;
}>;

export class GithubPullRequestChecksService {
  static create(dependencies: GithubPullRequestChecksDependencies): GithubPullRequestChecksService {
    return new GithubPullRequestChecksService(dependencies);
  }

  private constructor(private readonly deps: GithubPullRequestChecksDependencies) {}

  /** Never throws: a delivery is acknowledged whatever happens to it. */
  async applyCheckSuiteCompleted(suite: GithubAgentCheckSuiteCompleted): Promise<void> {
    try {
      await this.recordWhenFinished(suite);
    } catch (error) {
      logger.warn(
        {
          error,
          installationId: suite.installationId,
          repository: suite.repositoryFullName,
          headSha: suite.headSha,
        },
        "github check suite handling failed",
      );
    }
  }

  private async recordWhenFinished(suite: GithubAgentCheckSuiteCompleted): Promise<void> {
    const installation = await this.deps.installations.findByInstallationId(suite.installationId);
    if (!installation) return;

    const location = {
      installationId: suite.installationId,
      repositoryId: suite.repositoryId,
      owner: suite.repositoryOwner,
      repo: suite.repositoryName,
    };
    const verdict = judgeCommitChecks(
      await this.deps.appTokens.readCommitChecks({ ...location, sha: suite.headSha }),
    );
    if (verdict.kind === "running") return;

    const openNumbers = await this.openPullRequests(location, suite.pullRequestNumbers);
    if (openNumbers.length === 0) return;

    await this.deps.facts.recordPullRequestChecksCompleted({
      organizationId: installation.organizationId,
      installationId: suite.installationId,
      repositoryHost: this.deps.host.getHost(),
      repositoryFullName: suite.repositoryFullName,
      headBranch: suite.headBranch,
      headSha: suite.headSha,
      pullRequestNumbers: openNumbers,
      conclusion: verdict.conclusion,
      failedChecks: verdict.failedChecks,
    });
  }

  private async openPullRequests(
    location: { installationId: string; repositoryId: string; owner: string; repo: string },
    numbers: readonly number[],
  ): Promise<number[]> {
    const open: number[] = [];
    for (const number of numbers) {
      const pull = await this.deps.appTokens.getPullRequest({ ...location, number });
      if (pull.state === "open") open.push(number);
    }
    return open;
  }
}
