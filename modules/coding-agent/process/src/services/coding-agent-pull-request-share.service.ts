import type { CodingAgentSessionBranchRecord } from "@langwatch/coding-agent-contract";

import { MAX_USAGE_CONTEXTS } from "../eventing/coding-agent-session-state.projection.ts";
import type { SessionModelTotalsRow } from "../repositories/coding-agent-session-event.repository.ts";
import {
  allocateCounters,
  isStampedOnRepository,
  isUnstamped,
  costOf,
  type StampedUsage,
  tokensOf,
  weighing,
} from "../rules/coding-agent-pull-request-share.rules.ts";
import type {
  AssignablePullRequest,
  CodingAgentPullRequestAssignmentService,
} from "./coding-agent-pull-request-assignment.service.ts";

export interface PullRequestAttribution {
  /**
   * The candidate sessions scaled to their share of THIS pull request, ready
   * to be grouped and summed exactly like whole sessions were. A session with
   * no share is absent.
   */
  sessions: CodingAgentSessionBranchRecord[];
  /**
   * The per-model event totals that belong to THIS pull request: rows stamped onto its
   * branch, plus each attached session's unstamped rows where this pull request is the
   * legacy winner.
   */
  modelTotals: SessionModelTotalsRow[];
}

/** The bucket a row falls in, named without reference to any pull request. */
const UNSTAMPED_BUCKET = "\0unstamped";
const ELSEWHERE_BUCKET = "\0elsewhere";
const BRANCH_BUCKET_PREFIX = "branch\0";

/**
 * The proportional rule: how much of one session's cost belongs to one pull request.
 * @see specs/coding-agent/pull-request-linkage.feature
 */
export class CodingAgentPullRequestShareService {
  static create(deps: {
    assignments: CodingAgentPullRequestAssignmentService;
  }): CodingAgentPullRequestShareService {
    return new CodingAgentPullRequestShareService(deps);
  }

  private constructor(
    private readonly dependencies: {
      assignments: CodingAgentPullRequestAssignmentService;
    },
  ) {}

  /** `tenantId\0sessionId`, the identity a session has across both reads. */
  static sessionKey(session: { tenantId: string; sessionId: string }): string {
    return `${session.tenantId}\0${session.sessionId}`;
  }

  /**
   * Attribute the candidate sessions' usage to one pull request.
   */
  attribute({
    sessions,
    rowMatchedSessionKeys,
    pullRequests,
    prNumber,
    repositoryHost,
    repositoryFullName,
    modelTotals,
  }: {
    sessions: readonly CodingAgentSessionBranchRecord[];
    rowMatchedSessionKeys: ReadonlySet<string>;
    pullRequests: readonly AssignablePullRequest[];
    prNumber: number;
    repositoryHost: string;
    repositoryFullName: string;
    modelTotals: readonly SessionModelTotalsRow[];
  }): PullRequestAttribution {
    const totalsBySession = CodingAgentPullRequestShareService.groupBySession(modelTotals);
    const scaled: CodingAgentSessionBranchRecord[] = [];
    const attributedTotals: SessionModelTotalsRow[] = [];

    for (const session of sessions) {
      const key = CodingAgentPullRequestShareService.sessionKey(session);
      const share = this.shareOfPullRequest({
        session,
        rows: totalsBySession.get(key) ?? [],
        rowMatched: rowMatchedSessionKeys.has(key),
        pullRequests,
        prNumber,
        repositoryHost,
        repositoryFullName,
      });
      if (share === null) {
        continue;
      }

      scaled.push(share.session);
      attributedTotals.push(...share.prRows);
    }

    return { sessions: scaled, modelTotals: attributedTotals };
  }

  /**
   * One session's share of the pull request: the session scaled to it, and the
   * event rows behind it. Null when this pull request gets none of the session.
   */
  private shareOfPullRequest({
    session,
    rows,
    rowMatched,
    pullRequests,
    prNumber,
    repositoryHost,
    repositoryFullName,
  }: {
    session: CodingAgentSessionBranchRecord;
    rows: readonly SessionModelTotalsRow[];
    rowMatched: boolean;
    pullRequests: readonly AssignablePullRequest[];
    prNumber: number;
    repositoryHost: string;
    repositoryFullName: string;
  }): {
    session: CodingAgentSessionBranchRecord;
    prRows: SessionModelTotalsRow[];
  } | null {
    const ledger = CodingAgentPullRequestShareService.ledgerOf({ session, rows });
    const { weightOf, totalWeight } = weighing(ledger);

    const { perBranch, legacyWinner, declaredBranches } = this.branchTenure({
      session,
      ledger,
      rows,
      pullRequests,
      repositoryHost,
      repositoryFullName,
    });

    // No record, or one that reports neither tokens nor cost: nothing to
    // divide by, so the legacy whole-session rule stands — and only where the
    // session's own row lives, like always.
    if (totalWeight === 0) {
      if (!rowMatched || legacyWinner !== prNumber) {
        return null;
      }

      return { session, prRows: [] };
    }

    // Bucket the record by a key that depends on the SESSION alone, never on
    // which pull request is being asked about. That is what makes the integer
    // allocation below the same answer in every read: each pull request takes a
    // disjoint set of whole buckets, so their counters cannot sum past the
    // session's own however many reads ask.
    const buckets = CodingAgentPullRequestShareService.bucketWeights({
      ledger,
      weightOf,
      repositoryHost,
      repositoryFullName,
    });

    const unstampedWinner = CodingAgentPullRequestShareService.unstampedWinnerOf({
      ledger,
      weightOf,
      declaredBranches,
      perBranch,
      legacyWinner,
      repositoryHost,
      repositoryFullName,
      saturated: session.usageByContext.length >= MAX_USAGE_CONTEXTS,
    });

    return this.ownedShare({
      session,
      rows,
      rowMatched,
      unstampedWinner,
      perBranch,
      prNumber,
      buckets,
      totalWeight,
      repositoryHost,
      repositoryFullName,
    });
  }

  /** The buckets this pull request owns, and the session and fact rows scaled to them. */
  private ownedShare({
    session,
    rows,
    rowMatched,
    unstampedWinner,
    perBranch,
    prNumber,
    buckets,
    totalWeight,
    repositoryHost,
    repositoryFullName,
  }: {
    session: CodingAgentSessionBranchRecord;
    rows: readonly SessionModelTotalsRow[];
    rowMatched: boolean;
    unstampedWinner: number | undefined;
    perBranch: ReadonlyMap<string, number>;
    prNumber: number;
    buckets: ReadonlyMap<string, number>;
    totalWeight: number;
    repositoryHost: string;
    repositoryFullName: string;
  }): {
    session: CodingAgentSessionBranchRecord;
    prRows: SessionModelTotalsRow[];
  } | null {
    const ownsBucket = (key: string): boolean => {
      if (key === ELSEWHERE_BUCKET) {
        return false;
      }

      if (key === UNSTAMPED_BUCKET) {
        return rowMatched && unstampedWinner === prNumber;
      }

      return perBranch.get(key.slice(BRANCH_BUCKET_PREFIX.length)) === prNumber;
    };

    const ownKeys = [...buckets.keys()].filter(ownsBucket);
    const prWeight = ownKeys.reduce((total, key) => total + buckets.get(key)!, 0);
    if (prWeight <= 0) {
      return null;
    }

    // The model breakdown follows the same ownership, whichever record set the
    // weights: a fact row lands on the pull request that owns its bucket.
    const prRows = rows.filter((row) =>
      ownsBucket(
        CodingAgentPullRequestShareService.bucketKeyOf({
          usage: row,
          repositoryHost,
          repositoryFullName,
        }),
      ),
    );
    const allocated = allocateCounters({
      session,
      buckets,
      totalWeight,
      ownKeys,
    });

    return {
      session: {
        ...session,
        ...allocated,
        // Cost is never rounded: it is a currency amount, so the share stays
        // exact and only the integer counters need whole units handed out.
        costUsd: (session.costUsd * prWeight) / totalWeight,
      },
      prRows,
    };
  }

  /**
   * Which pull request each of the session's branches belongs to, and the legacy whole-session
   * winner. The stamps may name branches the session row's bounded branch set no longer holds,
   * so the tenure rule is asked about the union of both.
   */
  private branchTenure({
    session,
    ledger,
    rows,
    pullRequests,
    repositoryHost,
    repositoryFullName,
  }: {
    session: CodingAgentSessionBranchRecord;
    ledger: readonly StampedUsage[];
    rows: readonly SessionModelTotalsRow[];
    pullRequests: readonly AssignablePullRequest[];
    repositoryHost: string;
    repositoryFullName: string;
  }): {
    perBranch: ReadonlyMap<string, number>;
    legacyWinner: number | undefined;
    declaredBranches: readonly string[];
  } {
    const stampedBranches = [...ledger, ...rows]
      .filter((usage) =>
        isStampedOnRepository({
          usage,
          repositoryHost,
          repositoryFullName,
        }),
      )
      .map((usage) => usage.branch);
    const declaredBranches = this.dependencies.assignments.branchesOf(session);
    const headBranches = [...new Set([...declaredBranches, ...stampedBranches])];
    const assignable = [
      { sessionId: session.sessionId, startedAtMs: session.startedAtMs, headBranches },
    ];

    return {
      declaredBranches,
      perBranch:
        this.dependencies.assignments
          .assignDrivingSessionsPerBranch({ sessions: assignable, pullRequests })
          .get(session.sessionId) ?? new Map<string, number>(),
      legacyWinner: this.dependencies.assignments
        .assignDrivingSessions({ sessions: assignable, pullRequests })
        .get(session.sessionId),
    };
  }

  /**
   * What the split weighs a session by: its row's per-context usage where it
   * carries any, the per-call fact rows otherwise, plus the counters' excess
   * over the record as one unstamped entry — never negative.
   */
  private static ledgerOf({
    session,
    rows,
  }: {
    session: CodingAgentSessionBranchRecord;
    rows: readonly SessionModelTotalsRow[];
  }): readonly StampedUsage[] {
    const recorded = session.usageByContext.filter(
      (usage) => tokensOf(usage) > 0 || costOf(usage) > 0,
    );
    if (recorded.length === 0) {
      return rows;
    }

    const remainder = (field: keyof StampedUsage & keyof CodingAgentSessionBranchRecord): number =>
      Math.max(0, session[field] - recorded.reduce((total, usage) => total + usage[field], 0));

    return [
      ...recorded,
      {
        repositoryHost: "",
        repositoryOwner: "",
        repositoryName: "",
        branch: "",
        inputTokens: remainder("inputTokens"),
        outputTokens: remainder("outputTokens"),
        cacheReadTokens: remainder("cacheReadTokens"),
        cacheCreationTokens: remainder("cacheCreationTokens"),
        costUsd: remainder("costUsd"),
      },
    ];
  }

  /**
   * Buckets rows by a key depending on the SESSION alone, never the pull
   * request asked about — each pull request takes a disjoint set of whole
   * buckets, so counters can't sum past the session's own reads.
   */
  private static bucketWeights({
    ledger,
    weightOf,
    repositoryHost,
    repositoryFullName,
  }: {
    ledger: readonly StampedUsage[];
    weightOf: (usage: StampedUsage) => number;
    repositoryHost: string;
    repositoryFullName: string;
  }): Map<string, number> {
    const buckets = new Map<string, number>();
    for (const usage of ledger) {
      const key = CodingAgentPullRequestShareService.bucketKeyOf({
        usage,
        repositoryHost,
        repositoryFullName,
      });
      buckets.set(key, (buckets.get(key) ?? 0) + weightOf(usage));
    }

    return buckets;
  }

  private static bucketKeyOf({
    usage,
    repositoryHost,
    repositoryFullName,
  }: {
    usage: StampedUsage;
    repositoryHost: string;
    repositoryFullName: string;
  }): string {
    if (isUnstamped(usage)) {
      return UNSTAMPED_BUCKET;
    }

    if (
      !isStampedOnRepository({
        usage,
        repositoryHost,
        repositoryFullName,
      })
    ) {
      return ELSEWHERE_BUCKET;
    }

    return `${BRANCH_BUCKET_PREFIX}${usage.branch}`;
  }

  /**
   * Which pull request the session's undeclared usage follows: its FIRST
   * declared branch, and only where the ledger's first entry of that name was
   * declared on THIS repository; nobody, where the record saturated.
   * @see specs/coding-agent/pull-request-linkage.feature
   */
  private static unstampedWinnerOf({
    ledger,
    weightOf,
    declaredBranches,
    perBranch,
    legacyWinner,
    repositoryHost,
    repositoryFullName,
    saturated,
  }: {
    ledger: readonly StampedUsage[];
    weightOf: (usage: StampedUsage) => number;
    declaredBranches: readonly string[];
    perBranch: ReadonlyMap<string, number>;
    legacyWinner: number | undefined;
    repositoryHost: string;
    repositoryFullName: string;
    saturated: boolean;
  }): number | undefined {
    const declared = ledger.filter((usage) => !isUnstamped(usage) && weightOf(usage) > 0);
    if (declared.length === 0) {
      return legacyWinner;
    }

    if (saturated) {
      return undefined;
    }

    const firstBranch = declaredBranches[0];
    if (firstBranch === undefined) {
      return undefined;
    }

    const firstNamed = declared.find((usage) => usage.branch === firstBranch);
    if (
      firstNamed !== undefined &&
      !isStampedOnRepository({
        usage: firstNamed,
        repositoryHost,
        repositoryFullName,
      })
    ) {
      return undefined;
    }

    return perBranch.get(firstBranch);
  }

  private static groupBySession(
    rows: readonly SessionModelTotalsRow[],
  ): Map<string, SessionModelTotalsRow[]> {
    const grouped = new Map<string, SessionModelTotalsRow[]>();
    for (const row of rows) {
      const key = CodingAgentPullRequestShareService.sessionKey(row);
      const list = grouped.get(key) ?? [];
      list.push(row);
      grouped.set(key, list);
    }

    return grouped;
  }
}
