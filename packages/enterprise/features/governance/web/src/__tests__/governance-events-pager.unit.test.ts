// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Cursor-walk logic for the source events table. The server hands out
 * events strictly OLDER than a timestamp cursor (no id tiebreak, no
 * total), so the walk overlaps each boundary by one millisecond and
 * drops the rows it has already shown — otherwise events sharing the
 * boundary millisecond would be skipped forever.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *       (rule "The events table pages through everything the source
 *       ever ingested")
 */
import { describe, expect, it } from "vitest";

import {
  absorbFetch,
  buildPageRequest,
  paginationView,
  SERVER_MAX_LIMIT,
  stallSkipRequest,
} from "../governance-events-pager";

const iso = (ms: number) => new Date(ms).toISOString();

const row = (eventId: string, tsMs: number) => ({
  eventId,
  eventTimestampIso: iso(tsMs),
});

const T = Date.parse("2026-08-20T12:00:00.000Z");

describe("given the first page of events", () => {
  it("anchors at server-now (no cursor) and asks for one sentinel row extra", () => {
    const req = buildPageRequest({ pageSize: 25, displayedRows: [] });
    expect(req.beforeIso).toBeUndefined();
    expect(req.limit).toBe(26);
    expect(req.dropIds).toEqual([]);
  });

  /** @scenario "The table pages through more events than fit at once" */
  it("shows pageSize rows and knows there is more when the sentinel came back", () => {
    const req = buildPageRequest({ pageSize: 3, displayedRows: [] });
    const fetched = [
      row("a", T + 40),
      row("b", T + 30),
      row("c", T + 20),
      row("d", T + 10),
    ];
    const result = absorbFetch({ pageSize: 3, request: req, fetched });
    expect(result.rows.map((r) => r.eventId)).toEqual(["a", "b", "c"]);
    expect(result.hasMore).toBe(true);
    expect(result.isStalled).toBe(false);
  });

  it("shows everything and stops when the fetch came back short", () => {
    const req = buildPageRequest({ pageSize: 3, displayedRows: [] });
    const fetched = [row("a", T + 40), row("b", T + 30)];
    const result = absorbFetch({ pageSize: 3, request: req, fetched });
    expect(result.rows.map((r) => r.eventId)).toEqual(["a", "b"]);
    expect(result.hasMore).toBe(false);
  });
});

describe("given a next-page request after distinct timestamps", () => {
  it("overlaps the boundary by 1ms and drops only the boundary row", () => {
    const displayed = [row("a", T + 40), row("b", T + 30), row("c", T + 20)];
    const req = buildPageRequest({ pageSize: 3, displayedRows: displayed });
    expect(req.beforeIso).toBe(iso(T + 21));
    expect(req.dropIds).toEqual(["c"]);
    // pageSize + 1 dropped row to re-fetch + 1 sentinel
    expect(req.limit).toBe(5);
  });
});

describe("given events stamped with the same millisecond at a page boundary", () => {
  /** @scenario "Events sharing a timestamp are not lost at a page boundary" */
  it("re-fetches the tied rows, drops the ones already shown, and keeps the rest", () => {
    // Page 1 showed a, b, c where b and c are tied at T — and d, also at T,
    // fell off the server's slice. A naive `beforeIso = T` walk loses d.
    const displayed = [row("a", T + 40), row("b", T), row("c", T)];
    const req = buildPageRequest({ pageSize: 3, displayedRows: displayed });
    expect(req.beforeIso).toBe(iso(T + 1));
    expect(req.dropIds).toEqual(["b", "c"]);
    expect(req.limit).toBe(6);

    const fetched = [row("b", T), row("c", T), row("d", T), row("e", T - 10)];
    const result = absorbFetch({ pageSize: 3, request: req, fetched });
    expect(result.rows.map((r) => r.eventId)).toEqual(["d", "e"]);
    expect(result.hasMore).toBe(false);
  });

  it("collects boundary drops across the whole displayed history, not just the last page", () => {
    // Both trailing rows of the history share the boundary millisecond.
    const displayed = [row("a", T + 40), row("b", T), row("c", T), row("d", T)];
    const req = buildPageRequest({ pageSize: 4, displayedRows: displayed });
    expect(req.dropIds).toEqual(["b", "c", "d"]);
  });

  it("caps the over-fetch at the server's maximum limit", () => {
    const displayed = Array.from({ length: 199 }, (_, i) => row(`t${i}`, T));
    const req = buildPageRequest({ pageSize: 100, displayedRows: displayed });
    expect(req.limit).toBe(SERVER_MAX_LIMIT);
  });

  it("declares a stall when a full fetch contained nothing new, and the skip request moves strictly past the boundary", () => {
    const displayed = [row("b", T), row("c", T)];
    const req = buildPageRequest({ pageSize: 2, displayedRows: displayed });
    const fetched = [
      row("b", T),
      row("c", T),
      row("x-seen-not-dropped", T),
      row("y", T),
      row("z", T),
    ];
    // Simulate the pathological case: everything fresh got filtered or the
    // server keeps returning the same tied window. Here: all returned rows
    // are drops.
    const stalledResult = absorbFetch({
      pageSize: 2,
      request: { ...req, dropIds: ["b", "c", "x-seen-not-dropped", "y", "z"] },
      fetched,
    });
    expect(stalledResult.rows).toEqual([]);
    expect(stalledResult.isStalled).toBe(true);

    const skip = stallSkipRequest({ pageSize: 2, displayedRows: displayed });
    expect(skip.beforeIso).toBe(iso(T)); // strict <, ties knowingly skipped
    expect(skip.dropIds).toEqual([]);
    expect(skip.limit).toBe(3);
  });

  it("does not declare a stall when the empty fetch was simply short (end of data)", () => {
    const req = buildPageRequest({ pageSize: 2, displayedRows: [row("b", T)] });
    const result = absorbFetch({
      pageSize: 2,
      request: req,
      fetched: [row("b", T)],
    });
    expect(result.rows).toEqual([]);
    expect(result.isStalled).toBe(false);
    expect(result.hasMore).toBe(false);
  });
});

describe("given the pagination bar needs numbers a cursor cannot give", () => {
  /** @scenario "The pager offers no control it cannot honour" */
  it("counts page slots plus one sentinel row while more exists", () => {
    const midWalk = paginationView({
      pageSize: 25,
      loadedPages: 3,
      lastPageCount: 25,
      hasMore: true,
    });
    expect(midWalk.totalCount).toBe(76);
    expect(midWalk.canGoNext).toBe(true);
    expect(midWalk.maxReachablePage).toBe(4);
    expect(midWalk.isPageReachable(3)).toBe(true);
    expect(midWalk.isPageReachable(4)).toBe(true);
    expect(midWalk.isPageReachable(5)).toBe(false);
  });

  it("settles on the exact count once the walk hits the end", () => {
    const done = paginationView({
      pageSize: 25,
      loadedPages: 4,
      lastPageCount: 10,
      hasMore: false,
    });
    expect(done.totalCount).toBe(85);
    expect(done.canGoNext).toBe(false);
    expect(done.maxReachablePage).toBe(4);
  });

  it("keeps the next page reachable even when a loaded page came up short", () => {
    // Tie-drops (or the server cap) can leave a non-final page holding
    // fewer than pageSize rows. A row-count total would then put
    // totalPages below the pages already walked, and the bar's clamp
    // would strand the walk. Slots, not rows, drive the page count.
    const shortMidWalk = paginationView({
      pageSize: 10,
      loadedPages: 2,
      lastPageCount: 3,
      hasMore: true,
    });
    expect(shortMidWalk.maxReachablePage).toBe(3);
    expect(Math.ceil(shortMidWalk.totalCount / 10)).toBe(3);
    expect(shortMidWalk.canGoNext).toBe(true);
    expect(shortMidWalk.isPageReachable(3)).toBe(true);
  });

  it("reports zero for a source that loaded nothing, hiding the bar", () => {
    const empty = paginationView({
      pageSize: 25,
      loadedPages: 1,
      lastPageCount: 0,
      hasMore: false,
    });
    expect(empty.totalCount).toBe(0);
  });
});
