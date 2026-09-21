/**
 * Where a stopped page is cut, and what the cut keeps.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import {
  cutPageAtStop,
  INSTANT_EVAL_CANCEL_POLL_MS,
  INSTANT_EVAL_PAGE_SETTLE_MS,
  pageDeadlineMs,
  pageStopReason,
  type InstantEvalStoppablePage,
} from "../instant-eval-page-stop.rules.ts";
import type { InstantEvalRowKey } from "../instant-eval-row-keys.rules.ts";

const NOW = 1_758_000_000_000;

function rowKey(traceId: string): InstantEvalRowKey {
  return { traceId, threadId: `thread-${traceId}`, spanId: "", occurredAt: NOW - 1_000 };
}

function judgedPage(
  rows: readonly Record<string, unknown>[],
  unjudgedRows?: readonly number[],
): InstantEvalStoppablePage {
  return { rows, ...(unjudgedRows ? { cancellation: { unjudgedRows } } : {}) };
}

const KEYS = [rowKey("t1"), rowKey("t2"), rowKey("t3"), rowKey("t4")];
const ROWS = KEYS.map((key) => ({ TraceId: key.traceId, annoyed: 0.5 }));

describe("given a page judged to the end", () => {
  describe("when it is cut", () => {
    it("keeps every row and ends on the last key", () => {
      const cut = cutPageAtStop({ judged: judgedPage(ROWS), keys: KEYS });

      expect(cut.rows).toHaveLength(4);
      expect(cut.unjudgedIndexes.size).toBe(0);
      expect(cut.last?.traceId).toBe("t4");
      expect(cut.isCutShort).toBe(false);
    });
  });
});

describe("given a page a stop reached part way", () => {
  describe("when the rows after the last judged one are unjudged", () => {
    /** @scenario "A page stopped part way keeps the judgements it made" */
    it("keeps up to the last judged row and leaves the rest for the next page", () => {
      const cut = cutPageAtStop({ judged: judgedPage(ROWS, [2, 3]), keys: KEYS });

      expect(cut.rows.map((row) => row.TraceId)).toEqual(["t1", "t2"]);
      expect(cut.unjudgedIndexes.size).toBe(0);
      expect(cut.last?.traceId).toBe("t2");
      expect(cut.isCutShort).toBe(true);
    });
  });

  describe("when a row before the last judged one was left unjudged", () => {
    it("keeps it and names it, so the cursor moves past it without a hole", () => {
      const cut = cutPageAtStop({ judged: judgedPage(ROWS, [1, 3]), keys: KEYS });

      expect(cut.rows.map((row) => row.TraceId)).toEqual(["t1", "t2", "t3"]);
      expect([...cut.unjudgedIndexes]).toEqual([1]);
      expect(cut.last?.traceId).toBe("t3");
      expect(cut.isCutShort).toBe(true);
    });
  });

  describe("when nothing was judged before the stop", () => {
    it("keeps nothing and ends on no key", () => {
      const cut = cutPageAtStop({ judged: judgedPage(ROWS, [0, 1, 2, 3]), keys: KEYS });

      expect(cut.rows).toHaveLength(0);
      expect(cut.last).toBeUndefined();
      expect(cut.isCutShort).toBe(true);
    });
  });

  describe("when the stop is named on the rows it reached", () => {
    it("tells a deadline apart from a cancellation", () => {
      expect(pageStopReason("deadline")).toBe("page_deadline");
      expect(pageStopReason("cancelled")).toBe("cancelled");
    });
  });
});

describe("given a delivery with a lease", () => {
  describe("when the page deadline is computed", () => {
    /** @scenario "A page judges under a deadline inside its lease" */
    it("keeps the settle margin and one cancel poll back from the lease", () => {
      expect(pageDeadlineMs({ deadlineAt: 1_000_000, now: 400_000 })).toBe(
        600_000 - INSTANT_EVAL_PAGE_SETTLE_MS - INSTANT_EVAL_CANCEL_POLL_MS,
      );
    });

    it("is unbounded where nothing leased the delivery", () => {
      expect(pageDeadlineMs({ deadlineAt: null, now: 400_000 })).toBe(Number.POSITIVE_INFINITY);
    });
  });
});
