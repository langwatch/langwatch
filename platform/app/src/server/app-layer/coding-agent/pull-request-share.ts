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
 *     (`assignDrivingSessionsToPullRequestsPerBranch`).
 *   - Stamped on another repository: counted in the denominator only; that
 *     repository's own read prices it.
 *   - Unstamped (history from before the stamp, sessions that never declared):
 *     follows the legacy whole-session rule, and ONLY in the repository the
 *     session's own row points at — the same place the legacy read charged it.
 *
 * A session with no event rows at all keeps the legacy rule whole: its full
 * total lands on its single winner, so nothing regresses to zero.
 *
 * Pure and synchronous, like `pull-request-assignment.ts`: it decides from the
 * rows it is handed, so the same rule answers the same way in the rollup and
 * in a test.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import {
  type AssignablePullRequest,
  assignDrivingSessionsToPullRequests,
  assignDrivingSessionsToPullRequestsPerBranch,
  branchesOf,
} from "./pull-request-assignment";
import type { CodingAgentBranchSessionRow } from "./repositories/coding-agent-session.repository";
import type { SessionModelTotalsRow } from "./repositories/coding-agent-session-events.repository";

export interface PullRequestAttribution {
  /**
   * The candidate sessions scaled to their share of THIS pull request, ready
   * to be grouped and summed exactly like whole sessions were. A session with
   * no share is absent.
   */
  sessions: CodingAgentBranchSessionRow[];
  /**
   * The per-model event totals that belong to THIS pull request: rows stamped
   * onto its branch, plus each attached session's unstamped rows where this
   * pull request is the legacy winner. Per-call facts, deliberately unscaled —
   * they are measurements, not shares.
   */
  modelTotals: SessionModelTotalsRow[];
}

/**
 * Attribute the candidate sessions' usage to one pull request.
 *
 * `rowMatchedSessionKeys` names the candidates whose own session row matches
 * this repository (`tenantId\0sessionId`); only those may receive the
 * unstamped bucket here. A session discovered through its stamps alone
 * belongs to another repository's row now, and that repository's read is
 * where its unstamped tokens are priced — charging them here too would count
 * them twice across the organization.
 */
export function attributeSessionsToPullRequest({
  sessions,
  rowMatchedSessionKeys,
  pullRequests,
  prNumber,
  repositoryHost,
  repositoryFullName,
  modelTotals,
}: {
  sessions: readonly CodingAgentBranchSessionRow[];
  rowMatchedSessionKeys: ReadonlySet<string>;
  pullRequests: readonly AssignablePullRequest[];
  prNumber: number;
  repositoryHost: string;
  repositoryFullName: string;
  modelTotals: readonly SessionModelTotalsRow[];
}): PullRequestAttribution {
  const totalsBySession = groupBySession(modelTotals);
  const scaled: CodingAgentBranchSessionRow[] = [];
  const attributedTotals: SessionModelTotalsRow[] = [];

  for (const session of sessions) {
    const key = sessionKey(session);
    const rows = totalsBySession.get(key) ?? [];
    const rowMatched = rowMatchedSessionKeys.has(key);
    const { share, prRows } = shareOfPullRequest({
      session,
      rows,
      rowMatched,
      pullRequests,
      prNumber,
      repositoryHost,
      repositoryFullName,
    });
    if (share <= 0) continue;
    scaled.push(scaleSession(session, share));
    attributedTotals.push(...prRows);
  }

  return { sessions: scaled, modelTotals: attributedTotals };
}

/** One session's share of the pull request, and the event rows behind it. */
function shareOfPullRequest({
  session,
  rows,
  rowMatched,
  pullRequests,
  prNumber,
  repositoryHost,
  repositoryFullName,
}: {
  session: CodingAgentBranchSessionRow;
  rows: readonly SessionModelTotalsRow[];
  rowMatched: boolean;
  pullRequests: readonly AssignablePullRequest[];
  prNumber: number;
  repositoryHost: string;
  repositoryFullName: string;
}): { share: number; prRows: SessionModelTotalsRow[] } {
  const totalWeight = rows.reduce((sum, row) => sum + weightOf(row), 0);

  // The stamps may name branches the session row's bounded branch set no
  // longer holds, so the tenure rule is asked about the union of both.
  const stampedBranches = rows
    .filter((row) => isStampedOnRepository(row, repositoryHost, repositoryFullName))
    .map((row) => row.branch);
  const headBranches = [
    ...new Set([...branchesOf(session), ...stampedBranches]),
  ];
  const assignable = [
    {
      sessionId: session.sessionId,
      startedAtMs: session.startedAtMs,
      headBranches,
    },
  ];
  const perBranch =
    assignDrivingSessionsToPullRequestsPerBranch({
      sessions: assignable,
      pullRequests,
    }).get(session.sessionId) ?? new Map<string, number>();
  const legacyWinner = assignDrivingSessionsToPullRequests({
    sessions: assignable,
    pullRequests,
  }).get(session.sessionId);

  // No event rows: nothing to divide by, so the legacy whole-session rule
  // stands — and only where the session's own row lives, like always.
  if (totalWeight === 0) {
    return {
      share: rowMatched && legacyWinner === prNumber ? 1 : 0,
      prRows: [],
    };
  }

  const prRows = rows.filter((row) => {
    if (isUnstamped(row)) {
      return rowMatched && legacyWinner === prNumber;
    }
    return (
      isStampedOnRepository(row, repositoryHost, repositoryFullName) &&
      perBranch.get(row.branch) === prNumber
    );
  });
  const prWeight = prRows.reduce((sum, row) => sum + weightOf(row), 0);

  return { share: prWeight / totalWeight, prRows };
}

/** The session's counters and cost scaled to its share of the pull request. */
function scaleSession(
  session: CodingAgentBranchSessionRow,
  share: number,
): CodingAgentBranchSessionRow {
  if (share >= 1) return session;
  return {
    ...session,
    inputTokens: Math.round(session.inputTokens * share),
    outputTokens: Math.round(session.outputTokens * share),
    cacheReadTokens: Math.round(session.cacheReadTokens * share),
    cacheCreationTokens: Math.round(session.cacheCreationTokens * share),
    costUsd: session.costUsd * share,
  };
}

/**
 * A row written before its session declared a working context. Stamps are
 * written all-or-nothing (`isStampableContext`), so any missing field means
 * the whole stamp is absent; checking each guards a partially stamped row
 * from ever matching a pull request by accident.
 */
function isUnstamped(row: SessionModelTotalsRow): boolean {
  return (
    row.repositoryOwner === "" || row.repositoryName === "" || row.branch === ""
  );
}

/**
 * Case-folded like every repository comparison on this path: a stamp carries
 * the remote's casing verbatim, the mapping stores lower case. Branch names
 * stay case sensitive and are compared by the caller.
 */
function isStampedOnRepository(
  row: SessionModelTotalsRow,
  repositoryHost: string,
  repositoryFullName: string,
): boolean {
  if (isUnstamped(row)) return false;
  return (
    row.repositoryHost.toLowerCase() === repositoryHost.toLowerCase() &&
    `${row.repositoryOwner}/${row.repositoryName}`.toLowerCase() ===
      repositoryFullName.toLowerCase()
  );
}

function weightOf(row: SessionModelTotalsRow): number {
  return (
    row.inputTokens +
    row.outputTokens +
    row.cacheReadTokens +
    row.cacheCreationTokens
  );
}

export function sessionKey(session: {
  tenantId: string;
  sessionId: string;
}): string {
  return `${session.tenantId}\0${session.sessionId}`;
}

function groupBySession(
  rows: readonly SessionModelTotalsRow[],
): Map<string, SessionModelTotalsRow[]> {
  const grouped = new Map<string, SessionModelTotalsRow[]>();
  for (const row of rows) {
    const key = sessionKey(row);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return grouped;
}
