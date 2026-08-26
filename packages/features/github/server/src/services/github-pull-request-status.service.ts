/**
 * Live pull-request status.
 *
 * The stored `GithubPullRequest` row is a snapshot taken when the branch was
 * mapped, and a pull request's state is the one thing about it that moves after
 * that. Rather than have the queue chase every state change of every mapped
 * pull request, the reader asks GitHub when someone is actually looking, and a
 * 60-second Redis entry keeps a page of rows, a refresh and a second viewer
 * from each costing their own call.
 *
 * A per-ref failure is not a failure of the read. GitHub rate limiting us, the
 * App having been uninstalled, or the network being the network all degrade to
 * the stored label marked `snapshot`, because a stale label with an honest
 * provenance is better than an error page over a cost table. Only invalid input
 * fails the whole call.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { GithubInstallationsService } from "./github-installations.service";
import type {
  GithubAppTokenPort,
  GithubPullRequestSummary,
} from "../ports/github-app-token.port";
import type {
  GithubPullRequestRow,
  GithubPullRequestsRepository,
} from "../repositories/github-pull-requests.repository";
import type { GithubPullRequestStatusCacheService } from "./github-pull-request-status-cache.service";

const logger = createLogger("langwatch:github:pull-request-status");

/** Most refs one call may ask about. A page of rows, not a crawl. */
export const MAX_STATUS_REFS = 50;

export type GithubPullRequestStatus = "open" | "draft" | "merged" | "closed";

export interface GithubPullRequestRef {
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
}

export interface GithubPullRequestLiveStatus extends GithubPullRequestRef {
  status: GithubPullRequestStatus;
  /** "live" when GitHub answered (or answered recently), "snapshot" otherwise. */
  source: "live" | "snapshot";
  /** When the mapping first stored this pull request; null when unmapped. */
  mappedAt: Date | null;
}

export interface GithubPullRequestStatusServiceDeps {
  repository: GithubPullRequestsRepository;
  installations: GithubInstallationsService;
  appTokens: GithubAppTokenPort;
  cache: GithubPullRequestStatusCacheService;
}

/**
 * The status a pull request's own fields imply. Merge time wins over state
 * because GitHub reports a merged pull request as closed, and "closed" for
 * something that shipped would read as abandoned.
 */
export class GithubPullRequestStatusService {
  static deriveStatus(input: {
    mergedAt: string | Date | null;
    state: string;
    draft: boolean;
  }): GithubPullRequestStatus {
    if (input.mergedAt) {
      return "merged";
    }
    if (input.state === "closed") {
      return "closed";
    }
    if (input.draft) {
      return "draft";
    }
    return "open";
  }

  static create(
    deps: GithubPullRequestStatusServiceDeps,
  ): GithubPullRequestStatusService {
    return new GithubPullRequestStatusService(deps);
  }

  private readonly deps: GithubPullRequestStatusServiceDeps;

  private constructor(deps: GithubPullRequestStatusServiceDeps) {
    this.deps = deps;
  }

  /**
   * The current status of up to {@link MAX_STATUS_REFS} pull requests, in the
   * order asked. Refs the organization has never mapped are omitted rather than
   * guessed at: a status for a pull request we know nothing about would be an
   * invention, and the caller reads absence.
   */
  async getLiveStatuses({
    organizationId,
    refs,
  }: {
    organizationId: string;
    refs: readonly GithubPullRequestRef[];
  }): Promise<GithubPullRequestLiveStatus[]> {
    assertValidRefs(refs);
    const out: GithubPullRequestLiveStatus[] = [];
    for (const ref of refs) {
      const status = await this.statusForRef({ organizationId, ref });
      if (status) {
        out.push(status);
      }
    }
    return out;
  }

  private async statusForRef({
    organizationId,
    ref,
  }: {
    organizationId: string;
    ref: GithubPullRequestRef;
  }): Promise<GithubPullRequestLiveStatus | null> {
    const stored = await this.deps.repository.tryFindByNumber({
      organizationId,
      ...ref,
    });
    if (!stored) {
      return null;
    }

    const cached = await this.deps.cache.tryRead({ organizationId, ref });
    if (cached) {
      return {
        ...ref,
        status: cached,
        source: "live",
        mappedAt: stored.mappedAt,
      };
    }

    try {
      const live = await this.readFromGithub({ organizationId, ref });
      if (!live) {
        return this.snapshotAnswer(ref, stored);
      }
      const status = GithubPullRequestStatusService.deriveStatus({
        mergedAt: live.mergedAt,
        state: live.state,
        draft: live.draft,
      });
      await this.deps.cache.write({ organizationId, ref, status });
      if (status !== this.statusFromRow(stored)) {
        this.refreshSnapshot({ organizationId, ref, live });
      }
      return { ...ref, status, source: "live", mappedAt: stored.mappedAt };
    } catch (error) {
      // Rate limited, uninstalled, network: the reader still gets a label,
      // and `source` tells them how old it may be.
      logger.warn(
        { error, organizationId, ...ref },
        "live pull-request status read failed, answering from the snapshot",
      );
      return this.snapshotAnswer(ref, stored);
    }
  }

  private snapshotAnswer(
    ref: GithubPullRequestRef,
    stored: GithubPullRequestRow,
  ): GithubPullRequestLiveStatus {
    return {
      ...ref,
      status: this.statusFromRow(stored),
      source: "snapshot",
      mappedAt: stored.mappedAt,
    };
  }

  private statusFromRow(row: GithubPullRequestRow): GithubPullRequestStatus {
    return GithubPullRequestStatusService.deriveStatus({
      mergedAt: row.prMergedAt,
      state: row.state,
      draft: row.isDraft,
    });
  }

  private async readFromGithub({
    organizationId,
    ref,
  }: {
    organizationId: string;
    ref: GithubPullRequestRef;
  }): Promise<GithubPullRequestSummary | null> {
    const covering = await this.deps.installations.tryResolveInstallationForRepository({
      organizationId,
      repositoryFullName: ref.repositoryFullName,
    });
    if (!covering) {
      return null;
    }
    const [owner, repo] = ref.repositoryFullName.split("/");
    if (!owner || !repo) {
      return null;
    }
    return this.deps.appTokens.getPullRequest({
      installationId: covering.installationId,
      repositoryId: covering.repositoryId,
      owner,
      repo,
      number: ref.prNumber,
    });
  }

  /**
   * Bring the stored snapshot back in line with what GitHub just said.
   * Fire-and-forget: the reader already has their answer, and a failed write
   * only means the next live read refreshes it instead.
   */
  private refreshSnapshot({
    organizationId,
    ref,
    live,
  }: {
    organizationId: string;
    ref: GithubPullRequestRef;
    live: GithubPullRequestSummary;
  }): void {
    void this.deps.repository
      .refreshSnapshot({
        organizationId,
        repositoryHost: ref.repositoryHost,
        repositoryFullName: ref.repositoryFullName,
        prNumber: ref.prNumber,
        title: live.title,
        state: live.state,
        isDraft: live.draft,
        prClosedAt: live.closedAt ? new Date(live.closedAt) : null,
        prMergedAt: live.mergedAt ? new Date(live.mergedAt) : null,
        prUpdatedAt: new Date(live.updatedAt),
      })
      .catch((error: unknown) => {
        logger.warn(
          { error, organizationId, ...ref },
          "could not refresh the stored pull-request snapshot",
        );
      });
  }
}

/**
 * Input is the one thing this read refuses outright. A malformed ref cannot be
 * answered from a snapshot either, and answering "unknown" for it would hide a
 * caller's bug behind a status the UI renders.
 */
function assertValidRefs(refs: readonly GithubPullRequestRef[]): void {
  if (refs.length === 0) {
    return;
  }
  if (refs.length > MAX_STATUS_REFS) {
    throw new ValidationError(
      `At most ${MAX_STATUS_REFS} pull requests can be read at once`,
    );
  }
  for (const ref of refs) {
    const looksLikeRepository = /^[^/\s]+\/[^/\s]+$/.test(ref.repositoryFullName);
    if (!looksLikeRepository) {
      throw new ValidationError("repositoryFullName must be owner/name");
    }
    if (!Number.isInteger(ref.prNumber) || ref.prNumber <= 0) {
      throw new ValidationError("prNumber must be a positive integer");
    }
    if (!ref.repositoryHost) {
      throw new ValidationError("repositoryHost is required");
    }
  }
}
