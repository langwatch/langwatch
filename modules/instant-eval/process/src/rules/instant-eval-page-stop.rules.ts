/**
 * A page that stopped before its last row: what is kept, and where the run
 * resumes. A cancellation and an expiring lease both stop a page, and either
 * way the classifications that came back were paid for, so they are written.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import {
  findInstantEvalRowKeys,
  instantEvalKeyIndex,
  type InstantEvalRowKey,
} from "./instant-eval-row-keys.rules.ts";

/** What stopped a page, when something did. */
export type InstantEvalPageStop = "cancelled" | "deadline";

/**
 * How often a page in flight re-reads the cancellation: a Stop is answered
 * within about a second, at one read per interval rather than one per
 * classification.
 */
export const INSTANT_EVAL_CANCEL_POLL_MS = 1_000;

/**
 * Time a page keeps back from its lease for settling and writing. A minute
 * covers one insert and one outcome write under a slow database, and is small
 * next to the ten minute lease it comes out of.
 */
export const INSTANT_EVAL_PAGE_SETTLE_MS = 60_000;

/** The reason written on a row the stop reached before its verdict did. */
export function pageStopReason(stop: InstantEvalPageStop): string {
  return stop === "deadline" ? "page_deadline" : "cancelled";
}

/**
 * How long a page may judge before its lease is at risk; unbounded where
 * nothing leased the delivery. The poll interval comes off the margin because
 * a cancellation is noticed one interval late, and the deadline should not be.
 */
export function pageDeadlineMs({
  deadlineAt,
  now,
}: {
  deadlineAt: number | null | undefined;
  now: number;
}): number {
  if (deadlineAt === null || deadlineAt === undefined) return Number.POSITIVE_INFINITY;

  return deadlineAt - now - INSTANT_EVAL_PAGE_SETTLE_MS - INSTANT_EVAL_CANCEL_POLL_MS;
}

/** The part of a judged page a cut reads: its rows, and what the stop left unjudged. */
export interface InstantEvalStoppablePage {
  readonly rows: readonly Record<string, unknown>[];
  readonly cancellation?: { readonly unjudgedRows: readonly number[] };
}

export interface InstantEvalPageCut {
  /** The rows the page keeps: everything up to and including the last judged row. */
  readonly rows: readonly Record<string, unknown>[];
  /** Indexes into `rows` that carry no verdict because of the stop. */
  readonly unjudgedIndexes: ReadonlySet<number>;
  /** The key the kept rows end on, or undefined when nothing was judged. */
  readonly last: InstantEvalRowKey | undefined;
  /** Whether rows after the last judged one were left for the next page. */
  readonly isCutShort: boolean;
}

/**
 * Cuts a judged page at its last judged row. A row before it with no verdict
 * is kept and named in `unjudgedIndexes` so the cursor moves past it without a
 * hole; the rows after it are left for the next page.
 */
export function cutPageAtStop({
  judged,
  keys,
}: {
  judged: InstantEvalStoppablePage;
  keys: readonly InstantEvalRowKey[];
}): InstantEvalPageCut {
  if (!judged.cancellation) {
    return {
      rows: judged.rows,
      unjudgedIndexes: new Set(),
      last: keys.at(-1),
      isCutShort: false,
    };
  }

  const unjudged = new Set(judged.cancellation.unjudgedRows);
  let lastJudged = -1;
  for (let index = judged.rows.length - 1; index >= 0; index--) {
    if (!unjudged.has(index)) {
      lastJudged = index;
      break;
    }
  }
  const rows = judged.rows.slice(0, lastJudged + 1);

  return {
    rows,
    unjudgedIndexes: new Set([...unjudged].filter((index) => index <= lastJudged)),
    last:
      lastJudged >= 0
        ? findInstantEvalRowKeys({
            row: rows[lastJudged]!,
            keysByRow: instantEvalKeyIndex(keys),
          }).at(0)
        : undefined,
    isCutShort: lastJudged < judged.rows.length - 1,
  };
}
