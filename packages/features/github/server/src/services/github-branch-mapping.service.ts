import {
  GITHUB_LINKING_PULL_REQUEST_ACTIONS,
  type GithubPullRequestEvent,
} from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import {
  type GithubAppTokenPort,
  type GithubPullRequestSummary,
  GithubRateLimitedError,
} from "../ports/github-app-token.port";
import type { GithubHostPort } from "../ports/github-host.port";
import type {
  GithubPullRequestsRepository,
  UpsertGithubPullRequestInput,
} from "../repositories/github-pull-requests.repository";
import type { GithubInstallationsService } from "./github-installations.service";

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
  originProjectId?: string;
};
export type BranchMappingRequest = {
  tenantId: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
};
type BranchScope = {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
};
type BranchMappingDeps = {
  repository: GithubPullRequestsRepository;
  installations: GithubInstallationsService;
  appTokens: GithubAppTokenPort;
  project: ProjectService;
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

export class GithubBranchMappingService {
  static create(deps: BranchMappingDeps): GithubBranchMappingService {
    return new GithubBranchMappingService(deps);
  }

  private constructor(private readonly deps: BranchMappingDeps) {}

  async request(request: BranchMappingRequest): Promise<void> {
    if (!this.deps.host.isMappable(request.repositoryHost)) {
      return;
    }

    let organizationId: string;
    try {
      organizationId = await this.deps.project.getOrganizationId(request.tenantId);
    } catch {
      return;
    }

    const target: BranchMappingTarget = {
      organizationId,
      repositoryHost: request.repositoryHost,
      repositoryOwner: request.repositoryOwner,
      repositoryName: request.repositoryName,
      headBranch: request.headBranch,
      origin: "demand",
      originProjectId: request.tenantId,
    };
    await this.bringRecheckForward(target);
    await this.map(target);
  }

  async applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean> {
    const links = GITHUB_LINKING_PULL_REQUEST_ACTIONS.some(
      (action) => action === event.action,
    );
    if (!links) {
      return false;
    }

    const installation = await this.deps.installations.tryGetByInstallationId(
      event.installationId,
    );
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

  async map(target: BranchMappingTarget): Promise<void> {
    const scope = this.tryScope(target);
    if (!scope) {
      return;
    }

    const covering = await this.deps.installations.tryResolveInstallationForRepository({
      organizationId: scope.organizationId,
      repositoryFullName: scope.repositoryFullName,
    });
    if (!covering || !(await this.claim(scope, target.origin))) {
      return;
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
        originProjectId: target.originProjectId,
      });
    } catch (error) {
      await this.recordFailure(scope, error, target.origin);
    }
  }

  private async bringRecheckForward(target: BranchMappingTarget): Promise<void> {
    const scope = this.tryScope(target);
    if (!scope) {
      return;
    }

    await this.deps.repository.bringBranchRecheckForward({
      ...scope,
      dueAt: new Date(nowMs(this.deps) + ACTIVE_BRANCH_MAX_BACKOFF_MS),
    });
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
    originProjectId?: string;
  }): Promise<void> {
    const now = new Date(nowMs(this.deps));
    if (input.pullRequests.length > 0) {
      await this.deps.repository.upsertPullRequests({
        pullRequests: input.pullRequests.map((pull) =>
          this.toUpsertInput(input.scope, pull),
        ),
      });
      await this.tryRecordProjectActivity(input.originProjectId, now);
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
      recheckAfter: hasPullRequests
        ? null
        : new Date(now.getTime() + backoffMsFor(attempts)),
      attempts,
      lastRequestedAt: input.origin === "demand" ? now : null,
    });
  }

  private async tryRecordProjectActivity(
    projectId: string | undefined,
    at: Date,
  ): Promise<void> {
    if (!projectId) {
      return;
    }

    try {
      await this.deps.project.touchCodingAgentPullRequestSeen({ projectId, at });
    } catch (error) {
      logger.warn({ error, projectId }, "failed to record PR project activity");
    }
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
