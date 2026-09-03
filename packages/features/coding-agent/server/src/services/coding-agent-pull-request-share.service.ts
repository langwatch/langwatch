import type { CodingAgentSessionBranchRecord } from "@langwatch/coding-agent-contract";
import type { SessionModelTotalsRow } from "../repositories/coding-agent-session-event.repository";
import type {
  AssignablePullRequest,
  CodingAgentPullRequestAssignmentService,
} from "./coding-agent-pull-request-assignment.service";

export interface PullRequestAttribution {
  /**
   * The candidate sessions scaled to their share of THIS pull request, ready
   * to be grouped and summed exactly like whole sessions were. A session with
   * no share is absent.
   */
  sessions: CodingAgentSessionBranchRecord[];
  /**
   * The per-model event totals that belong to THIS pull request: rows stamped
   * onto its branch, plus each attached session's unstamped rows where this
   * pull request is the legacy winner. Per-call facts, deliberately unscaled —
   * they are measurements, not shares.
   */
  modelTotals: SessionModelTotalsRow[];
}

/** The bucket a row falls in, named without reference to any pull request. */
const UNSTAMPED_BUCKET = "\0unstamped";
const ELSEWHERE_BUCKET = "\0elsewhere";
const BRANCH_BUCKET_PREFIX = "branch\0";

const COUNTER_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
] as const;

/**
 * The proportional rule: how much of one session's cost belongs to one pull
 * request.
 *
 * A session's cumulative counters stay the source of truth for WHAT was spent;
 * its stamped fact rows decide WHERE. Each `model_call` row carries the
 * repository and branch that were active when the call happened, so per pull
 * request the split is:
 *
 *   share      = (event tokens whose stamp lands on this pull request)
 *              / (all of the session's event tokens)
 *   PR portion = share x the session's cumulative counters
 *
 * Three buckets partition a session's event tokens, so its shares across pull
 * requests can never sum past one and a repository's pull requests never sum
 * to more than was spent:
 *
 *   - Stamped on this repository: goes to the branch's own tenure winner
 *     (`assignDrivingSessionsPerBranch`).
 *   - Stamped on another repository: counted in the denominator only; that
 *     repository's own read prices it.
 *   - Unstamped (history from before the stamp, sessions that never declared):
 *     follows the legacy whole-session rule, and ONLY in the repository the
 *     session's own row points at — the same place the legacy read charged it.
 *
 * A session with no event rows at all keeps the legacy rule whole: its full
 * total lands on its single winner, so nothing regresses to zero.
 *
 * The token counters are whole numbers, so the split hands out whole units by
 * the largest-remainder method across all of a session's buckets at once,
 * rather than rounding each pull request's share on its own. Rounding
 * separately would let a one-token session split two ways report a token to
 * each, and on a page about cost, understating is survivable where
 * overstating is not. Cost is a currency amount and stays exact.
 *
 * Pure and synchronous, like the assignment service: it decides from the rows
 * it is handed, so the same rule answers the same way in the rollup and in a
 * test.
 *
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
   *
   * `rowMatchedSessionKeys` names the candidates whose own session row matches
   * this repository; only those may receive the unstamped bucket here. A
   * session discovered through its stamps alone belongs to another
   * repository's row now, and that repository's read is where its unstamped
   * tokens are priced — charging them here too would count them twice across
   * the organization.
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
      if (share === null) continue;
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
    const { weightOf, totalWeight } = CodingAgentPullRequestShareService.weighing(rows);

    // The stamps may name branches the session row's bounded branch set no
    // longer holds, so the tenure rule is asked about the union of both.
    const stampedBranches = rows
      .filter((row) =>
        CodingAgentPullRequestShareService.isStampedOnRepository({
          row,
          repositoryHost,
          repositoryFullName,
        }),
      )
      .map((row) => row.branch);
    const headBranches = [
      ...new Set([...this.dependencies.assignments.branchesOf(session), ...stampedBranches]),
    ];
    const assignable = [
      {
        sessionId: session.sessionId,
        startedAtMs: session.startedAtMs,
        headBranches,
      },
    ];
    const perBranch =
      this.dependencies.assignments
        .assignDrivingSessionsPerBranch({ sessions: assignable, pullRequests })
        .get(session.sessionId) ?? new Map<string, number>();
    const legacyWinner = this.dependencies.assignments
      .assignDrivingSessions({ sessions: assignable, pullRequests })
      .get(session.sessionId);

    // No event rows, or rows that report neither tokens nor cost: nothing to
    // divide by, so the legacy whole-session rule stands — and only where the
    // session's own row lives, like always.
    if (totalWeight === 0) {
      if (!rowMatched || legacyWinner !== prNumber) return null;
      return { session, prRows: [] };
    }

    // Bucket the rows by a key that depends on the SESSION alone, never on
    // which pull request is being asked about. That is what makes the integer
    // allocation below the same answer in every read: each pull request takes a
    // disjoint set of whole buckets, so their counters cannot sum past the
    // session's own however many reads ask.
    const buckets = new Map<string, number>();
    const bucketOf = new Map<SessionModelTotalsRow, string>();
    for (const row of rows) {
      const key = CodingAgentPullRequestShareService.bucketKeyOf({
        row,
        repositoryHost,
        repositoryFullName,
      });
      bucketOf.set(row, key);
      buckets.set(key, (buckets.get(key) ?? 0) + weightOf(row));
    }

    const ownsBucket = (key: string): boolean => {
      if (key === ELSEWHERE_BUCKET) return false;
      if (key === UNSTAMPED_BUCKET) return rowMatched && legacyWinner === prNumber;
      return perBranch.get(key.slice(BRANCH_BUCKET_PREFIX.length)) === prNumber;
    };

    const ownKeys = [...buckets.keys()].filter(ownsBucket);
    const prWeight = ownKeys.reduce((total, key) => total + buckets.get(key)!, 0);
    if (prWeight <= 0) return null;

    const prRows = rows.filter((row) => ownsBucket(bucketOf.get(row)!));
    const allocated = CodingAgentPullRequestShareService.allocateCounters({
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

  private static bucketKeyOf({
    row,
    repositoryHost,
    repositoryFullName,
  }: {
    row: SessionModelTotalsRow;
    repositoryHost: string;
    repositoryFullName: string;
  }): string {
    if (CodingAgentPullRequestShareService.isUnstamped(row)) return UNSTAMPED_BUCKET;
    if (
      !CodingAgentPullRequestShareService.isStampedOnRepository({
        row,
        repositoryHost,
        repositoryFullName,
      })
    ) {
      return ELSEWHERE_BUCKET;
    }
    return `${BRANCH_BUCKET_PREFIX}${row.branch}`;
  }

  /**
   * This pull request's whole-token share of each of the session's counters.
   *
   * Each counter is handed out across ALL of the session's buckets by the
   * largest-remainder method, and this pull request keeps the buckets it owns.
   * Rounding each share on its own instead would let a one-token session split
   * two ways report a token to each, and a page about cost may understate but
   * must never overstate.
   */
  private static allocateCounters({
    session,
    buckets,
    totalWeight,
    ownKeys,
  }: {
    session: CodingAgentSessionBranchRecord;
    buckets: ReadonlyMap<string, number>;
    totalWeight: number;
    ownKeys: readonly string[];
  }): Pick<CodingAgentSessionBranchRecord, (typeof COUNTER_FIELDS)[number]> {
    // Sorted so the allocation never depends on the order rows arrived in.
    const keys = [...buckets.keys()].sort();
    const owned = new Set(ownKeys);
    const allocated = {} as Record<(typeof COUNTER_FIELDS)[number], number>;

    for (const field of COUNTER_FIELDS) {
      const amount = Math.max(0, Math.floor(session[field]));
      const floors = new Map<string, number>();
      const remainders: Array<{ key: string; remainder: number }> = [];
      let handedOut = 0;

      for (const key of keys) {
        const exact = (amount * buckets.get(key)!) / totalWeight;
        const whole = Math.floor(exact);
        floors.set(key, whole);
        handedOut += whole;
        remainders.push({ key, remainder: exact - whole });
      }

      // What rounding down left over goes to the largest remainders first, ties
      // broken by key so two reads of the same session agree.
      remainders.sort((a, b) => b.remainder - a.remainder || (a.key < b.key ? -1 : 1));
      for (const { key } of remainders.slice(0, amount - handedOut)) {
        floors.set(key, floors.get(key)! + 1);
      }

      allocated[field] = keys
        .filter((key) => owned.has(key))
        .reduce((total, key) => total + floors.get(key)!, 0);
    }

    return allocated;
  }

  /**
   * A row written before its session declared a working context. Stamps are
   * written all-or-nothing (`isStampableContext`), so any missing field means
   * the whole stamp is absent; checking each guards a partially stamped row
   * from ever matching a pull request by accident.
   */
  private static isUnstamped(row: SessionModelTotalsRow): boolean {
    return row.repositoryOwner === "" || row.repositoryName === "" || row.branch === "";
  }

  /**
   * Case-folded like every repository comparison on this path: a stamp carries
   * the remote's casing verbatim, the mapping stores lower case. Branch names
   * stay case sensitive and are compared by the caller.
   */
  private static isStampedOnRepository({
    row,
    repositoryHost,
    repositoryFullName,
  }: {
    row: SessionModelTotalsRow;
    repositoryHost: string;
    repositoryFullName: string;
  }): boolean {
    if (CodingAgentPullRequestShareService.isUnstamped(row)) return false;
    return (
      row.repositoryHost.toLowerCase() === repositoryHost.toLowerCase() &&
      `${row.repositoryOwner}/${row.repositoryName}`.toLowerCase() ===
        repositoryFullName.toLowerCase()
    );
  }

  /**
   * The unit one session's rows are weighed in, and their total in that unit.
   *
   * Tokens whenever the session reports any: every agent reports them, and they
   * are what the counters being split are made of. A session that priced its
   * calls without reporting token counts is weighed by cost instead, so its
   * stamps still decide where the money lands rather than the whole session
   * falling back to the legacy rule. The unit is picked per session, so one
   * ratio never mixes dollars with tokens.
   */
  private static weighing(rows: readonly SessionModelTotalsRow[]): {
    weightOf: (row: SessionModelTotalsRow) => number;
    totalWeight: number;
  } {
    const tokensOf = CodingAgentPullRequestShareService.tokensOf;
    const costOf = CodingAgentPullRequestShareService.costOf;
    const tokenWeight = CodingAgentPullRequestShareService.sum(rows, tokensOf);
    if (tokenWeight > 0) return { weightOf: tokensOf, totalWeight: tokenWeight };
    return {
      weightOf: costOf,
      totalWeight: CodingAgentPullRequestShareService.sum(rows, costOf),
    };
  }

  private static tokensOf(row: SessionModelTotalsRow): number {
    return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheCreationTokens;
  }

  /** Never negative: a stray negative cost would eat another row's share. */
  private static costOf(row: SessionModelTotalsRow): number {
    return row.costUsd > 0 ? row.costUsd : 0;
  }

  private static sum(
    rows: readonly SessionModelTotalsRow[],
    of: (row: SessionModelTotalsRow) => number,
  ): number {
    return rows.reduce((total, row) => total + of(row), 0);
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
