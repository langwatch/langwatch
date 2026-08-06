/**
 * Branch to pull-request mapping: the write side of pull-request linkage.
 *
 * A folded coding-agent session names a repository and a branch. This service
 * asks the organization's GitHub connection which pull requests that branch has
 * ever hosted and stores every one of them, so attribution survives a branch
 * being merged and reused. Sessions are attached to those pull requests at READ
 * time by the tenure rule (pull-request-assignment.ts); nothing here decides
 * which session belongs to which pull request.
 *
 * Everything about it is designed to keep GitHub calls rare. A branch with no
 * pull request is the common case, so an empty answer arms a growing backoff
 * rather than being retried on the next fold; a branch that already mapped is
 * left alone for fifteen minutes; a branch nobody has asked about in a week
 * stops being swept at all.
 *
 * It never throws at its callers. The reactor that drives it runs on the fold's
 * queue, and a rethrow there would turn one rate-limited read into a retry
 * storm against the same rate limit.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import { createLogger } from "@langwatch/observability";
import type { GithubInstallationsService } from "./github-installations.service";
import {
  type GithubAppTokenService,
  GithubRateLimitedError,
} from "./githubAppToken";
import type {
  GithubPullRequestsRepository,
  UpsertGithubPullRequestInput,
} from "./repositories/github-pull-requests.repository";

const logger = createLogger("langwatch:github:pull-request-mapping");

/** The only host this maps. An unset host is the default one. */
export const GITHUB_HOST = "github.com";

/** How long a branch that resolved to a pull request is trusted. */
const FRESH_MAPPING_MS = 15 * 60 * 1000;

/**
 * How long a claim on one branch's lookup holds when nothing records an answer.
 *
 * Every path through `mapBranch` after the claim writes the bookkeeping row
 * again — found, empty, or rate limited — so this only ever expires for a
 * caller that died mid-lookup. A minute is longer than the GitHub call plus its
 * retries and short enough that a crashed worker does not park a branch.
 */
const LOOKUP_CLAIM_LEASE_MS = 60 * 1000;

/**
 * How long a skipped read waits before it bumps `lastRequestedAt` again. The
 * column only feeds the sweep's "does anyone still care" cut, which is a week
 * wide, so writing it on every read would be a write per page load for no gain.
 */
const REQUEST_TOUCH_MS = 60 * 60 * 1000;

/**
 * The backoff a branch with no pull request walks, indexed by how many empty
 * answers it has given. The last entry is the cap: a branch that has been empty
 * four times is a branch whose work never became a pull request, and asking
 * daily is generous.
 */
const EMPTY_BACKOFF_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

/** How far back the post-connect backfill looks for branches to map. */
export const BACKFILL_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Ceiling on the branches one backfill maps, across every project. */
export const BACKFILL_BRANCH_CAP = 500;
/** Sessions read per project during a backfill. */
const BACKFILL_SESSIONS_PER_PROJECT = 500;
/** Concurrent branch mappings during a backfill. */
const BACKFILL_CONCURRENCY = 5;

/** The session facts the backfill reads. Structural: the full row satisfies it. */
export interface BackfillSessionRow {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  gitBranch: string;
}

/** The narrow slice of the coding-agent session read the backfill needs. */
export interface CodingAgentSessionBranchLookup {
  listRecent(args: {
    projectId: string;
    fromMs: number;
    toMs: number;
    limit?: number;
  }): Promise<BackfillSessionRow[]>;
}

export interface GithubPullRequestMappingServiceDeps {
  repository: GithubPullRequestsRepository;
  installations: GithubInstallationsService;
  appTokens: GithubAppTokenService;
  /** projectId -> organizationId; the app's cached resolver satisfies it. */
  resolveOrganizationId(projectId: string): Promise<string | undefined>;
  /** The organization's project ids, for the post-connect backfill. */
  findProjectIds(organizationId: string): Promise<string[]>;
  sessions: CodingAgentSessionBranchLookup;
  /** Injectable clock so the backoff can be tested without waiting it out. */
  now?: () => number;
}

/** A repository and branch, already resolved to an organization. */
export interface BranchMappingTarget {
  organizationId: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
}

/** The same, addressed by the project a session was folded under. */
export interface BranchMappingRequest {
  tenantId: string;
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  headBranch: string;
}

/** An unset host means github.com; anything else is a host we do not map. */
export function isMappableHost(repositoryHost: string): boolean {
  return repositoryHost === "" || repositoryHost === GITHUB_HOST;
}

/** The host to store: the default, spelled out, so stored rows are comparable. */
export function normalizeHost(repositoryHost: string): string {
  return repositoryHost === "" ? GITHUB_HOST : repositoryHost;
}

/**
 * Wall clock in milliseconds, read off the injected deps.
 *
 * A free function, and never a method or a function-valued field on the
 * service, because the service is published through `traced()` — a Proxy that
 * hands back every function wrapped in a span. Reached as `this.now()` the
 * clock returns a Promise, which turns every window bound into NaN and every
 * `new Date(...)` into an Invalid Date, so the backoff never engages, the
 * backfill reads nothing and the bookkeeping write fails.
 */
function nowMs(deps: { now?: () => number }): number {
  return deps.now?.() ?? Date.now();
}

function backoffMsFor(attempts: number): number {
  const index = Math.min(
    Math.max(attempts - 1, 0),
    EMPTY_BACKOFF_MS.length - 1,
  );
  return EMPTY_BACKOFF_MS[index]!;
}

export class GithubPullRequestMappingService {
  private readonly deps: GithubPullRequestMappingServiceDeps;

  constructor(deps: GithubPullRequestMappingServiceDeps) {
    this.deps = deps;
  }

  /**
   * Map a branch named by the project a session was folded under. Resolves the
   * organization and delegates; a project with no organization is a no-op
   * rather than an error, because an orphan project is not something the
   * mapping can fix.
   */
  async requestBranchMapping(request: BranchMappingRequest): Promise<void> {
    if (!isMappableHost(request.repositoryHost)) return;
    const organizationId = await this.deps.resolveOrganizationId(
      request.tenantId,
    );
    if (!organizationId) return;
    await this.mapBranch({
      organizationId,
      repositoryHost: request.repositoryHost,
      repositoryOwner: request.repositoryOwner,
      repositoryName: request.repositoryName,
      headBranch: request.headBranch,
    });
  }

  /**
   * Map a branch for an organization. The core step: the sweep calls it
   * directly, having read the organization off the bookkeeping row.
   */
  async mapBranch(target: BranchMappingTarget): Promise<void> {
    if (!isMappableHost(target.repositoryHost)) return;
    const scope = {
      organizationId: target.organizationId,
      repositoryHost: normalizeHost(target.repositoryHost),
      repositoryFullName: `${target.repositoryOwner}/${target.repositoryName}`,
      headBranch: target.headBranch,
    };
    if (
      !scope.headBranch ||
      !target.repositoryOwner ||
      !target.repositoryName
    ) {
      return;
    }

    const covering =
      await this.deps.installations.resolveInstallationForRepository({
        organizationId: scope.organizationId,
        repositoryFullName: scope.repositoryFullName,
      });
    // No installation reaches this repository. Nothing is written, which is why
    // this is resolved BEFORE the claim: a bookkeeping row here would arm a
    // backoff against a branch we never actually asked GitHub about, and the
    // moment the customer connects the repository the backfill wants to map it
    // immediately.
    if (!covering) return;

    if (!(await this.claimLookup(scope))) return;

    try {
      const pullRequests = await this.deps.appTokens.listPullRequestsForHead({
        installationId: covering.installationId,
        repositoryId: covering.repositoryId,
        owner: target.repositoryOwner,
        repo: target.repositoryName,
        branch: scope.headBranch,
      });
      await this.recordAnswer({ scope, pullRequests });
    } catch (error) {
      await this.recordFailure({ scope, error });
    }
  }

  /**
   * Map every branch the organization's recent sessions ran on. Driven by the
   * connection being made: sessions folded before there was anything to ask
   * would otherwise wait for new activity on a branch that may already be
   * merged.
   */
  async runBackfillForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<void> {
    const toMs = nowMs(this.deps);
    const fromMs = toMs - BACKFILL_WINDOW_MS;
    const projectIds = await this.deps.findProjectIds(organizationId);
    const targets = new Map<string, BranchMappingTarget>();

    for (const projectId of projectIds) {
      if (targets.size >= BACKFILL_BRANCH_CAP) break;
      const sessions = await this.readSessionsForBackfill({
        organizationId,
        projectId,
        fromMs,
        toMs,
      });
      this.collectBranchTargets({ organizationId, sessions, targets });
    }

    await this.mapAllWithConcurrency([...targets.values()]);
  }

  /**
   * One project's recent sessions. A project whose sessions cannot be read is
   * skipped rather than failing the whole backfill.
   */
  private async readSessionsForBackfill({
    organizationId,
    projectId,
    fromMs,
    toMs,
  }: {
    organizationId: string;
    projectId: string;
    fromMs: number;
    toMs: number;
  }): Promise<BackfillSessionRow[]> {
    try {
      return await this.deps.sessions.listRecent({
        projectId,
        fromMs,
        toMs,
        limit: BACKFILL_SESSIONS_PER_PROJECT,
      });
    } catch (error) {
      logger.warn(
        { error, organizationId, projectId },
        "backfill could not read a project's sessions",
      );
      return [];
    }
  }

  /**
   * Add each session's branch to `targets`, deduped by repository and branch,
   * stopping at the cap so one busy organization cannot enqueue unbounded work.
   */
  private collectBranchTargets({
    organizationId,
    sessions,
    targets,
  }: {
    organizationId: string;
    sessions: BackfillSessionRow[];
    targets: Map<string, BranchMappingTarget>;
  }): void {
    for (const session of sessions) {
      if (targets.size >= BACKFILL_BRANCH_CAP) break;
      const target = this.targetFromSession({ organizationId, session });
      if (!target) continue;
      const key = [
        target.repositoryHost,
        target.repositoryOwner,
        target.repositoryName,
        target.headBranch,
      ].join("\0");
      if (!targets.has(key)) targets.set(key, target);
    }
  }

  private targetFromSession({
    organizationId,
    session,
  }: {
    organizationId: string;
    session: BackfillSessionRow;
  }): BranchMappingTarget | null {
    if (!isMappableHost(session.repositoryHost)) return null;
    if (
      !session.repositoryOwner ||
      !session.repositoryName ||
      !session.gitBranch
    ) {
      return null;
    }
    return {
      organizationId,
      repositoryHost: normalizeHost(session.repositoryHost),
      repositoryOwner: session.repositoryOwner,
      repositoryName: session.repositoryName,
      headBranch: session.gitBranch,
    };
  }

  private async mapAllWithConcurrency(
    targets: BranchMappingTarget[],
  ): Promise<void> {
    for (let i = 0; i < targets.length; i += BACKFILL_CONCURRENCY) {
      await Promise.all(
        targets.slice(i, i + BACKFILL_CONCURRENCY).map((target) =>
          this.mapBranch(target).catch((error: unknown) => {
            logger.warn(
              { error, ...target },
              "backfill could not map a branch",
            );
          }),
        ),
      );
    }
  }

  /**
   * Take the right to ask GitHub about this branch, or record that a reader
   * asked and stand down.
   *
   * One atomic write decides it. The read-then-write it replaces had a window
   * between the two statements wide enough for the workload this feature is
   * for: several agent worktrees on one branch fold within milliseconds of each
   * other, both read "nothing stored yet", and both call GitHub. Whichever
   * caller loses the claim still keeps the branch inside the sweep's activity
   * window, throttled — that touch is the whole reason a skip writes at all.
   */
  private async claimLookup(scope: BranchScope): Promise<boolean> {
    const now = nowMs(this.deps);
    const claimed = await this.deps.repository.claimBranchLookup({
      ...scope,
      now: new Date(now),
      freshMappingMs: FRESH_MAPPING_MS,
      leaseMs: LOOKUP_CLAIM_LEASE_MS,
    });
    if (claimed) return true;

    await this.deps.repository.touchBranchCheckRequestedAt({
      ...scope,
      lastRequestedAt: new Date(now),
      staleBefore: new Date(now - REQUEST_TOUCH_MS),
    });
    return false;
  }

  /** Store what GitHub answered, and set the next question's due date. */
  private async recordAnswer({
    scope,
    pullRequests,
  }: {
    scope: BranchScope;
    pullRequests: Awaited<
      ReturnType<GithubAppTokenService["listPullRequestsForHead"]>
    >;
  }): Promise<void> {
    const now = new Date(nowMs(this.deps));
    if (pullRequests.length > 0) {
      await this.deps.repository.upsertPullRequests({
        pullRequests: pullRequests.map((pull) =>
          toUpsertInput({ scope, pull }),
        ),
      });
    }

    const existing = await this.deps.repository.findBranchCheck(scope);
    const found = pullRequests.length > 0;
    const attempts = found ? 0 : (existing?.attempts ?? 0) + 1;
    await this.deps.repository.upsertBranchCheck({
      ...scope,
      lastCheckedAt: now,
      prCount: pullRequests.length,
      // Found clears the negative cache outright: the branch has an answer, and
      // a stale notFoundAt would keep the sweep asking about it forever.
      notFoundAt: found ? null : (existing?.notFoundAt ?? now),
      recheckAfter: found
        ? null
        : new Date(now.getTime() + backoffMsFor(attempts)),
      attempts,
      lastRequestedAt: now,
    });
  }

  /**
   * A read that failed. A rate limit arms the same backoff an empty answer
   * would, on `recheckAfter` alone: GitHub refused to answer, which is not the
   * same fact as "this branch has no pull request", and recording it as one
   * would leave a mapped branch wearing a negative cache.
   *
   * Every other failure is logged and its bookkeeping left alone, so the next
   * fold retries it — once the claim's lease has run out. That wait is the
   * point: a branch failing for a reason we do not model used to be re-asked on
   * every single fold commit, which is a retry loop dressed up as enrichment.
   */
  private async recordFailure({
    scope,
    error,
  }: {
    scope: BranchScope;
    error: unknown;
  }): Promise<void> {
    if (!(error instanceof GithubRateLimitedError)) {
      logger.warn({ error, ...scope }, "branch pull-request mapping failed");
      return;
    }
    const now = new Date(nowMs(this.deps));
    const existing = await this.deps.repository.findBranchCheck(scope);
    const attempts = (existing?.attempts ?? 0) + 1;
    await this.deps.repository.upsertBranchCheck({
      ...scope,
      lastCheckedAt: existing?.lastCheckedAt ?? now,
      prCount: existing?.prCount ?? 0,
      notFoundAt: existing?.notFoundAt ?? null,
      recheckAfter: new Date(now.getTime() + backoffMsFor(attempts)),
      attempts,
      lastRequestedAt: now,
    });
  }
}

/** The four columns that identify one branch's bookkeeping row. */
interface BranchScope {
  organizationId: string;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
}

function toUpsertInput({
  scope,
  pull,
}: {
  scope: BranchScope;
  pull: Awaited<
    ReturnType<GithubAppTokenService["listPullRequestsForHead"]>
  >[number];
}): UpsertGithubPullRequestInput {
  return {
    organizationId: scope.organizationId,
    repositoryHost: scope.repositoryHost,
    repositoryFullName: scope.repositoryFullName,
    headBranch: scope.headBranch,
    prNumber: pull.number,
    htmlUrl: pull.htmlUrl,
    title: pull.title,
    state: pull.state,
    isDraft: pull.draft,
    authorLogin: pull.authorLogin,
    prCreatedAt: new Date(pull.createdAt),
    prClosedAt: pull.closedAt ? new Date(pull.closedAt) : null,
    prMergedAt: pull.mergedAt ? new Date(pull.mergedAt) : null,
  };
}
