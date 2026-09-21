/**
 * The proportional rule: how much of one session's cost belongs to one pull
 * request.
 *
 * A session's cumulative counters stay the source of truth for WHAT was spent;
 * a per-context record decides WHERE. Two records exist, read in this order:
 *
 *   1. The session row's own `usageByContext` (migration 00097): the tokens
 *      and cost of every model call, charged by the fold to the repository
 *      and branch the call was stamped with. It covers every agent, including
 *      the ones whose tokens ride spans and so never reach the fact table.
 *      The gap between the counters and the record's sum is what the session
 *      spent before it declared anything (or before the column existed).
 *   2. The per-call `model_call` fact rows, each stamped the same way, for a
 *      row folded before the record existed. Log-carrier agents only.
 *
 * Per pull request the split is then:
 *
 *   share      = (record weight whose stamp lands on this pull request)
 *              / (the session's whole record weight)
 *   PR portion = share x the session's cumulative counters
 *
 * Three buckets partition a session's weight, so its shares across pull
 * requests can never sum past one and a repository's pull requests never sum
 * to more than was spent:
 *
 *   - Stamped on this repository: goes to the branch's own tenure winner
 *     (`assignDrivingSessionsToPullRequestsPerBranch`).
 *   - Stamped on another repository: counted in the denominator only; that
 *     repository's own read prices it.
 *   - Unstamped (before the first declaration, history from before the
 *     record, sessions that never declared): priced ONLY in the repository
 *     the session's own row points at. Where the session has declared work,
 *     it follows the session's FIRST declared context, the repository and
 *     branch it was on when the declarations began, and only when that
 *     repository is this one; a session that never declared keeps the legacy
 *     whole-session rule and lands on the pull request it opened first. A
 *     session that declared one branch for its whole life reads the same
 *     under both. A session whose record SATURATED at `MAX_USAGE_CONTEXTS`
 *     is the exception: its gap also holds contexts the fold could not open,
 *     so no pull request takes it.
 *
 * A session with no record at all keeps the legacy rule whole: its full
 * total lands on its single winner, so nothing regresses to zero.
 *
 * The token counters are whole numbers, so the split hands out whole units by
 * the largest-remainder method across all of a session's buckets at once,
 * rather than rounding each pull request's share on its own. Rounding
 * separately would let a one-token session split two ways report a token to
 * each, and on a page about cost, understating is survivable where
 * overstating is not. Cost is a currency amount and stays exact.
 *
 * Pure and synchronous, like `pull-request-assignment.ts`: it decides from the
 * rows it is handed, so the same rule answers the same way in the rollup and
 * in a test.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import { MAX_USAGE_CONTEXTS } from "~/server/event-sourcing/pipelines/coding-agent-processing/services/coding-agent-session.types";
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
   * pull request owns the unstamped bucket. Per-call facts, deliberately
   * unscaled — they are measurements, not shares.
   */
  modelTotals: SessionModelTotalsRow[];
}

/**
 * One stamped amount, from either record: where it was spent, and how much.
 * `SessionModelTotalsRow` and `SessionContextUsage` both have this shape.
 */
interface StampedUsage {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
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
    const share = shareOfPullRequest({
      session,
      rows,
      rowMatched,
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
}): {
  session: CodingAgentBranchSessionRow;
  prRows: SessionModelTotalsRow[];
} | null {
  const ledger = ledgerOf({ session, rows });
  const { weightOf, totalWeight } = weighing(ledger);

  // The stamps may name branches the session row's bounded branch set no
  // longer holds, so the tenure rule is asked about the union of both.
  const stampedBranches = [...ledger, ...rows]
    .filter((usage) =>
      isStampedOnRepository({ usage, repositoryHost, repositoryFullName }),
    )
    .map((usage) => usage.branch);
  const declaredBranches = branchesOf(session);
  const headBranches = [...new Set([...declaredBranches, ...stampedBranches])];
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

  // No record, or one that reports neither tokens nor cost: nothing to
  // divide by, so the legacy whole-session rule stands — and only where the
  // session's own row lives, like always.
  if (totalWeight === 0) {
    if (!rowMatched || legacyWinner !== prNumber) return null;
    return { session, prRows: [] };
  }

  // Bucket the record by a key that depends on the SESSION alone, never on
  // which pull request is being asked about. That is what makes the integer
  // allocation below the same answer in every read: each pull request takes a
  // disjoint set of whole buckets, so their counters cannot sum past the
  // session's own however many reads ask.
  const buckets = new Map<string, number>();
  for (const usage of ledger) {
    const key = bucketKeyOf({ usage, repositoryHost, repositoryFullName });
    buckets.set(key, (buckets.get(key) ?? 0) + weightOf(usage));
  }

  const unstampedWinner = unstampedWinnerOf({
    ledger,
    weightOf,
    declaredBranches,
    perBranch,
    legacyWinner,
    repositoryHost,
    repositoryFullName,
    saturated: session.usageByContext.length >= MAX_USAGE_CONTEXTS,
  });

  const ownsBucket = (key: string): boolean => {
    if (key === ELSEWHERE_BUCKET) return false;
    if (key === UNSTAMPED_BUCKET) {
      return rowMatched && unstampedWinner === prNumber;
    }
    return perBranch.get(branchOfBucketKey(key)) === prNumber;
  };

  const ownKeys = [...buckets.keys()].filter(ownsBucket);
  const prWeight = ownKeys.reduce((total, key) => total + buckets.get(key)!, 0);
  if (prWeight <= 0) return null;

  // The model breakdown follows the same ownership, whichever record set the
  // weights: a fact row lands on the pull request that owns its bucket.
  const prRows = rows.filter((row) =>
    ownsBucket(bucketKeyOf({ usage: row, repositoryHost, repositoryFullName })),
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
 * Which pull request the session's undeclared usage follows.
 *
 * Declared work anywhere, this repository or another, is what says the
 * undeclared usage came before the session's first declaration rather than
 * being the whole of it: it then follows the FIRST branch the session
 * declared, the branch it was on when the declarations began. A session that
 * declared nothing weighable keeps the legacy whole-session winner.
 *
 * Two sources answer this together, because neither can alone. The row's
 * branch set is ordered first seen first and holds every branch the session
 * declared, including ones it spent nothing weighable under, so it is what
 * names the FIRST branch — but it is names only. The row's repository is a
 * single field overwritten on every new declaration, so a session that moved
 * repositories keeps the old repository's branch names beside the new one's
 * with nothing on them to tell the two apart. Handing that bare name to
 * `perBranch`, which answers for THIS repository, would charge this
 * repository for work done in another one whenever the two share a branch
 * name, and names like `main` or a repeated `fix/...` collide readily.
 *
 * The ledger is what supplies the missing half: its entries carry a whole
 * context and are ordered first seen first, so the first of them carrying the
 * first branch's NAME is the repository that branch was first declared under.
 * When that is another repository, this repository's unstamped bucket is left
 * unowned — including when the session later worked a branch of the same name
 * here, since the pre-declaration usage still belongs behind the earlier one.
 * A first branch the ledger never weighed at all (declared, then departed
 * before spending anything) is not evidence of another repository, and falls
 * through to `perBranch` — which answers undefined for a branch with no pull
 * request here, the case that rule was written for.
 *
 * Only the row's record is ordered. On the legacy fact-row ledger the rows are
 * per-context aggregates that carry no ordering, so a branch name worked under
 * two repositories resolves to whichever row the query returned first. Every
 * session folded since 00097 carries the record and answers exactly.
 *
 * A SATURATED record is the last case. The fold stops opening contexts at
 * `MAX_USAGE_CONTEXTS`, so a session past that bound keeps charging calls to
 * the counters with nowhere to record where they went. Its gap is then part
 * pre-declaration usage and part dropped later contexts, and the two cannot
 * be told apart — following the first branch would charge a later branch's
 * spend to the first pull request. So nobody owns it: the weight stays in the
 * denominator, and every pull request's share shrinks by its own amount
 * instead of one of them absorbing the lot.
 */
function unstampedWinnerOf({
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
  const declared = ledger.filter(
    (usage) => !isUnstamped(usage) && weightOf(usage) > 0,
  );
  if (declared.length === 0) return legacyWinner;
  if (saturated) return undefined;

  const firstBranch = declaredBranches[0];
  if (firstBranch === undefined) return undefined;

  // The FIRST entry carrying that branch name, not any of them: the record is
  // ordered first seen first, so a session that worked a branch name here and
  // under another repository is answered by whichever came first, which is
  // the one the pre-declaration usage belongs behind.
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

/**
 * The record the split weighs a session by: the row's own per-context usage
 * when it carries any, the per-call fact rows otherwise.
 *
 * The row's record only holds stamped calls, so what the counters hold above
 * its sum is the session's undeclared usage and joins the record as one
 * unstamped entry. Never negative: the counters and the record are charged
 * from the same calls, so the difference can only be what came before the
 * record, but a stray inconsistency must not eat another bucket's share.
 */
function ledgerOf({
  session,
  rows,
}: {
  session: CodingAgentBranchSessionRow;
  rows: readonly SessionModelTotalsRow[];
}): readonly StampedUsage[] {
  const recorded = session.usageByContext.filter(
    (usage) => tokensOf(usage) > 0 || costOf(usage) > 0,
  );
  if (recorded.length === 0) return rows;

  const remainder = (field: keyof StampedUsage & keyof typeof session) =>
    Math.max(
      0,
      session[field] -
        recorded.reduce((total, usage) => total + usage[field], 0),
    );
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

/** The bucket an amount falls in, named without reference to any pull request. */
const UNSTAMPED_BUCKET = "\0unstamped";
const ELSEWHERE_BUCKET = "\0elsewhere";
const BRANCH_BUCKET_PREFIX = "branch\0";

function bucketKeyOf({
  usage,
  repositoryHost,
  repositoryFullName,
}: {
  usage: StampedUsage;
  repositoryHost: string;
  repositoryFullName: string;
}): string {
  if (isUnstamped(usage)) return UNSTAMPED_BUCKET;
  if (!isStampedOnRepository({ usage, repositoryHost, repositoryFullName })) {
    return ELSEWHERE_BUCKET;
  }
  return `${BRANCH_BUCKET_PREFIX}${usage.branch}`;
}

function branchOfBucketKey(key: string): string {
  return key.slice(BRANCH_BUCKET_PREFIX.length);
}

const COUNTER_FIELDS = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheCreationTokens",
] as const;

/**
 * This pull request's whole-token share of each of the session's counters.
 *
 * Each counter is handed out across ALL of the session's buckets by the
 * largest-remainder method, and this pull request keeps the buckets it owns.
 * Rounding each share on its own instead would let a one-token session split
 * two ways report a token to each, and a page about cost may understate but
 * must never overstate.
 */
function allocateCounters({
  session,
  buckets,
  totalWeight,
  ownKeys,
}: {
  session: CodingAgentBranchSessionRow;
  buckets: ReadonlyMap<string, number>;
  totalWeight: number;
  ownKeys: readonly string[];
}): Pick<CodingAgentBranchSessionRow, (typeof COUNTER_FIELDS)[number]> {
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
    remainders.sort(
      (a, b) => b.remainder - a.remainder || (a.key < b.key ? -1 : 1),
    );
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
 * An amount from before its session declared a working context. Stamps are
 * written all-or-nothing (`isStampableContext`), so any missing field means
 * the whole stamp is absent; checking each guards a partially stamped entry
 * from ever matching a pull request by accident.
 */
function isUnstamped(usage: StampedUsage): boolean {
  return (
    usage.repositoryOwner === "" ||
    usage.repositoryName === "" ||
    usage.branch === ""
  );
}

/**
 * Case-folded like every repository comparison on this path: a stamp carries
 * the remote's casing verbatim, the mapping stores lower case. Branch names
 * stay case sensitive and are compared by the caller.
 */
function isStampedOnRepository({
  usage,
  repositoryHost,
  repositoryFullName,
}: {
  usage: StampedUsage;
  repositoryHost: string;
  repositoryFullName: string;
}): boolean {
  if (isUnstamped(usage)) return false;
  return (
    usage.repositoryHost.toLowerCase() === repositoryHost.toLowerCase() &&
    `${usage.repositoryOwner}/${usage.repositoryName}`.toLowerCase() ===
      repositoryFullName.toLowerCase()
  );
}

/**
 * The unit one session's record is weighed in, and its total in that unit.
 *
 * Tokens whenever the session reports any: every agent reports them, and they
 * are what the counters being split are made of. A session that priced its
 * calls without reporting token counts is weighed by cost instead, so its
 * stamps still decide where the money lands rather than the whole session
 * falling back to the legacy rule. The unit is picked per session, so one
 * ratio never mixes dollars with tokens.
 */
function weighing(entries: readonly StampedUsage[]): {
  weightOf: (usage: StampedUsage) => number;
  totalWeight: number;
} {
  const tokenWeight = sum(entries, tokensOf);
  if (tokenWeight > 0) return { weightOf: tokensOf, totalWeight: tokenWeight };
  return { weightOf: costOf, totalWeight: sum(entries, costOf) };
}

function tokensOf(usage: StampedUsage): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheReadTokens +
    usage.cacheCreationTokens
  );
}

/** Never negative: a stray negative cost would eat another entry's share. */
function costOf(usage: StampedUsage): number {
  return usage.costUsd > 0 ? usage.costUsd : 0;
}

function sum(
  entries: readonly StampedUsage[],
  of: (usage: StampedUsage) => number,
): number {
  return entries.reduce((total, usage) => total + of(usage), 0);
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
