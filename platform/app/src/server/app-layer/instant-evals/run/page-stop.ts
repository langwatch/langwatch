/**
 * A page that stopped before its last row: what is kept, and where the run
 * resumes.
 *
 * Two things stop a page part way. A cancellation, which the run's owner asked
 * for, and the outbox lease running out, which nobody asked for but which
 * bounds the page all the same: past it another dispatcher may lease the same
 * intent and judge the page a second time, paying for it twice. Either way the
 * classifications that came back were paid for, so they are written rather
 * than thrown away, and the page reports where it got to.
 *
 * The rows kept are everything up to the last judged one. A row before it that
 * the stop reached first is written as skipped with the stop as its reason, so
 * the cursor can move past it without a hole in the accounting; the rows after
 * it are left for the next page, which starts from the last judged key.
 *
 * @see ./instant-eval-run.judge-page.ts
 * @see ./cancellation-watch.ts
 */

import { INSTANT_EVAL_CANCEL_POLL_MS } from "./cancellation-watch";
import { instantEvalKeyIndex, instantEvalRowKeyFor } from "./judgments";
import type { InstantEvalJudgedPage, InstantEvalRowKey } from "./row-source";

/** What stopped a page, when something did. */
export type InstantEvalPageStop = "cancelled" | "deadline";

/**
 * Time a page keeps back from its lease for settling and writing.
 *
 * The judging stops at the deadline, but the classifications already in
 * flight are abandoned rather than waited for, so what follows is one insert
 * and one outcome write. A minute covers both under a slow database with room
 * to spare, and is small next to the ten minute lease it comes out of.
 */
export const INSTANT_EVAL_PAGE_SETTLE_MS = 60_000;

/** The reason written on a row the stop reached before its verdict did. */
export function pageStopReason(stop: InstantEvalPageStop): string {
  return stop === "deadline" ? "page_deadline" : "cancelled";
}

/**
 * How long a page may judge before its lease is at risk, or null when nothing
 * leased it.
 *
 * Null for an unleased delivery, which is a suite driving the executor
 * directly; the shipped dispatcher always leases. The poll interval is added
 * to the settle margin because a cancellation is noticed one interval late,
 * and the deadline should not be.
 */
export function pageDeadlineMs({
  deadlineAt,
  now,
}: {
  deadlineAt: number | null | undefined;
  now: number;
}): number | null {
  if (deadlineAt === null || deadlineAt === undefined) return null;
  return (
    deadlineAt - now - INSTANT_EVAL_PAGE_SETTLE_MS - INSTANT_EVAL_CANCEL_POLL_MS
  );
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
 * Cuts a judged page at its last judged row.
 *
 * A page judged to the end is kept whole and ends on its last key. A stopped
 * page ends on the last row that has a verdict; a row before it with none is
 * kept and named in `unjudgedIndexes`, and the rows after it are dropped.
 */
export function cutPageAtStop({
  judged,
  keys,
}: {
  judged: InstantEvalJudgedPage;
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
  const unjudgedIndexes = new Set(
    [...unjudged].filter((index) => index <= lastJudged),
  );
  return {
    rows,
    unjudgedIndexes,
    last:
      lastJudged >= 0
        ? instantEvalRowKeyFor({
            row: rows[lastJudged]!,
            keysByRow: instantEvalKeyIndex(keys),
          })
        : undefined,
    isCutShort: lastJudged < judged.rows.length - 1,
  };
}
