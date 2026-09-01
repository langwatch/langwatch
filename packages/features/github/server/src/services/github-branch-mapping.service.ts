import {
  GITHUB_LINKING_PULL_REQUEST_ACTIONS,
  type GithubPullRequestEvent,
} from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";
import {
  type GithubAppTokenPort,
  type GithubPullRequestSummary,
  GithubRateLimitedError,
} from "../ports/github-app-token.port";
import type { GithubBranchInstallationsPort } from "../ports/github-branch-installations.port";
import type { GithubHostPort } from "../ports/github-host.port";
import type {
  GithubPullRequestsRepository,
  UpsertGithubPullRequestInput,
} from "../repositories/github-pull-requests.repository";

const logger = createLogger("langwatch:github:branch-mapping");
const FRESH_MAPPING_MS = 15 * 60 * 1000;
const LOOKUP_CLAIM_LEASE_MS = 60 * 1000;
const REQUEST_TOUCH_MS = 60 * 60 * 1000;
const EMPTY_BACKOFF_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;
const ACTIVE_BRANCH_MAX_BACKOFF_MS = EMPTY_BACKOFF_MS[0];

export type BranchMappingOrigin = "demand" | "sweep";
type BranchAddress = {
  organizationId: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
};
export type BranchMappingTarget = BranchAddress & {
  origin: BranchMappingOrigin;
};
type BranchScope = {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
};
type BranchMappingDeps = {
  repository: GithubPullRequestsRepository;
  installations: GithubBranchInstallationsPort;
  appTokens: GithubAppTokenPort;
  host: GithubHostPort;
  now?: () => number;
};

function nowMs(deps: { now?: () => number }): number {
  return deps.now?.() ?? Date.now();
}

function backoffMsFor(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), EMPTY_BACKOFF_MS.length - 1);
  return EMPTY_BACKOFF_MS[index]!;
}

/**
 * Asking GitHub which pull requests a branch has, and writing down the answer.
 *
 * This is the half the fleet-wide sweep runs, so its collaborators are the ones
 * the sweep can actually supply: the pull-request rows, the installation that
 * covers a repository, an App token, and the host. A project is deliberately
 * absent — the sweep walks branch bookkeeping that spans every tenant and has
 * no project in hand, and the one write that needed one (recording that a
 * customer's project saw a pull request) belongs to the demand side that asked.
 */
export class GithubBranchMappingService {
  static create(deps: BranchMappingDeps): GithubBranchMappingService {
    return new GithubBranchMappingService(deps);
  }

  private constructor(private readonly deps: BranchMappingDeps) {}

  async applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean> {
    const links = GITHUB_LINKING_PULL_REQUEST_ACTIONS.some((action) => action === event.action);
    if (!links) {
      return false;
    }

    const installation = await this.deps.installations.tryGetByInstallationId(event.installationId);
    if (!installation) {
      logger.info(
        { installationId: event.installationId, action: event.action },
        "pull request event has no local installation",
      );
      return false;
    }

    const scope = this.tryScope({
      organizationId: installation.organizationId,
      repositoryHost: this.deps.host.getHost(),
      repositoryOwner: event.repositoryOwner,
      repositoryName: event.repositoryName,
      headBranch: event.headBranch,
    });
    if (!scope) {
      return false;
    }

    await this.recordAnswer({
      scope,
      pullRequests: [event.pullRequest],
      isExhaustive: false,
      origin: "demand",
    });
    return true;
  }

  /**
   * Maps one branch, answering how many pull requests it recorded.
   *
   * The count is what the demand side reads: a project has seen a pull request
   * when a mapping it asked for found one, and every other outcome here — an
   * unmappable address, no installation covering the repository, a mapping
   * another worker already holds the claim on, a rate limit — is a zero.
   */
  async map(target: BranchMappingTarget): Promise<number> {
    const scope = this.tryScope(target);
    if (!scope) {
      return 0;
    }

    const covering = await this.deps.installations.tryResolveInstallationForRepository({
      organizationId: scope.organizationId,
      repositoryFullName: scope.repositoryFullName,
    });
    if (!covering || !(await this.claim(scope, target.origin))) {
      return 0;
    }

    try {
      const pullRequests = await this.deps.appTokens.listPullRequestsForHead({
        installationId: covering.installationId,
        repositoryId: covering.repositoryId,
        owner: target.repositoryOwner,
        repo: target.repositoryName,
        branch: scope.headBranch,
      });
      await this.recordAnswer({
        scope,
        pullRequests,
        isExhaustive: true,
        origin: target.origin,
      });
      return pullRequests.length;
    } catch (error) {
      await this.recordFailure(scope, error, target.origin);
      return 0;
    }
  }

  /**
   * Pulls a branch's next sweep into the active window.
   *
   * Demand is what this records: a branch somebody just asked about is worth
   * re-asking GitHub about soon, whatever backoff an earlier empty answer had
   * pushed it out to.
   */
  async bringRecheckForward(target: BranchMappingTarget): Promise<void> {
    const scope = this.tryScope(target);
    if (!scope) {
      return;
    }

    await this.deps.repository.bringBranchRecheckForward({
      ...scope,
      dueAt: new Date(nowMs(this.deps) + ACTIVE_BRANCH_MAX_BACKOFF_MS),
    });
  }

  private tryScope(address: BranchAddress): BranchScope | null {
    if (
      !this.deps.host.isMappable(address.repositoryHost) ||
      !address.headBranch ||
      !address.repositoryOwner ||
      !address.repositoryName
    ) {
      return null;
    }

    return {
      organizationId: address.organizationId,
      repositoryHost: this.deps.host.normalize(address.repositoryHost),
      repositoryFullName: `${address.repositoryOwner}/${address.repositoryName}`,
      headBranch: address.headBranch,
    };
  }

  private async claim(scope: BranchScope, origin: BranchMappingOrigin): Promise<boolean> {
    const now = nowMs(this.deps);
    const claimed = await this.deps.repository.claimBranchLookup({
      ...scope,
      now: new Date(now),
      freshMappingMs: FRESH_MAPPING_MS,
      leaseMs: LOOKUP_CLAIM_LEASE_MS,
      shouldRecordDemand: origin === "demand",
    });
    if (claimed || origin !== "demand") {
      return claimed;
    }

    await this.deps.repository.touchBranchCheckRequestedAt({
      ...scope,
      lastRequestedAt: new Date(now),
      staleBefore: new Date(now - REQUEST_TOUCH_MS),
    });
    return false;
  }

  private async recordAnswer(input: {
    scope: BranchScope;
    pullRequests: readonly GithubPullRequestSummary[];
    isExhaustive: boolean;
    origin: BranchMappingOrigin;
  }): Promise<void> {
    const now = new Date(nowMs(this.deps));
    if (input.pullRequests.length > 0) {
      await this.deps.repository.upsertPullRequests({
        pullRequests: input.pullRequests.map((pull) => this.toUpsertInput(input.scope, pull)),
      });
    }

    const existing = await this.deps.repository.tryFindBranchCheck(input.scope);
    const hasPullRequests = input.pullRequests.length > 0;
    const attempts = hasPullRequests ? 0 : (existing?.attempts ?? 0) + 1;
    await this.deps.repository.upsertBranchCheck({
      ...input.scope,
      lastCheckedAt: now,
      prCount: input.isExhaustive
        ? input.pullRequests.length
        : Math.max(existing?.prCount ?? 0, input.pullRequests.length),
      notFoundAt: hasPullRequests ? null : (existing?.notFoundAt ?? now),
      recheckAfter: hasPullRequests ? null : new Date(now.getTime() + backoffMsFor(attempts)),
      attempts,
      lastRequestedAt: input.origin === "demand" ? now : null,
    });
  }

  private async recordFailure(
    scope: BranchScope,
    error: unknown,
    origin: BranchMappingOrigin,
  ): Promise<void> {
    if (!(error instanceof GithubRateLimitedError)) {
      logger.warn({ error, ...scope }, "branch pull-request mapping failed");
      return;
    }

    const now = new Date(nowMs(this.deps));
    const existing = await this.deps.repository.tryFindBranchCheck(scope);
    const attempts = (existing?.attempts ?? 0) + 1;
    await this.deps.repository.upsertBranchCheck({
      ...scope,
      lastCheckedAt: existing?.lastCheckedAt ?? now,
      prCount: existing?.prCount ?? 0,
      notFoundAt: existing?.notFoundAt ?? null,
      recheckAfter: new Date(now.getTime() + backoffMsFor(attempts)),
      attempts,
      lastRequestedAt: origin === "demand" ? now : null,
    });
  }

  private toUpsertInput(
    scope: BranchScope,
    pull: GithubPullRequestSummary,
  ): UpsertGithubPullRequestInput {
    return {
      ...scope,
      prNumber: pull.number,
      htmlUrl: pull.htmlUrl,
      title: pull.title,
      state: pull.state,
      isDraft: pull.draft,
      authorLogin: pull.authorLogin,
      prCreatedAt: new Date(pull.createdAt),
      prClosedAt: pull.closedAt ? new Date(pull.closedAt) : null,
      prMergedAt: pull.mergedAt ? new Date(pull.mergedAt) : null,
      prUpdatedAt: new Date(pull.updatedAt),
    };
  }
}
