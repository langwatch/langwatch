/**
 * @vitest-environment node
 * @unit
 *
 * The Pull Requests table's order: what it opens on, what each column does
 * with the first, second and third click, and where a row a column does not
 * apply to ends up.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PULL_REQUEST_SORT,
  nextPullRequestSort,
  type PullRequestSortColumn,
  type PullRequestSortState,
  type SortablePullRequestRow,
  sortPullRequestRows,
} from "../src/pull-request-sort";

/**
 * One sortable row, filled in around whatever a case pins. Every fixture names
 * itself by its branch, which is the one field every row carries, so the order
 * a case asserts reads as a list of names.
 */
function row(
  over: Partial<SortablePullRequestRow> & { headBranch: string },
): SortablePullRequestRow {
  return {
    pullRequest: { number: 100, title: "A title" },
    snapshotStatus: "open",
    lastActivityAtMs: 1_000,
    modelBreakdown: [{ model: "claude-fable-5" }],
    totalTokens: 1_000,
    costUsd: 1,
    ...over,
  };
}

/** A row for a branch whose pull request has not been opened yet. */
function branchRow(
  over: Partial<SortablePullRequestRow> & { headBranch: string },
): SortablePullRequestRow {
  return row({
    pullRequest: null,
    snapshotStatus: null,
    modelBreakdown: [],
    ...over,
  });
}

const orderOf = (rows: readonly SortablePullRequestRow[]) =>
  rows.map((each) => each.headBranch);

/** The state a column lands in after `clicks` clicks, starting from default. */
function afterClicks({
  column,
  clicks,
}: {
  column: PullRequestSortColumn;
  clicks: number;
}): PullRequestSortState {
  let sort: PullRequestSortState = DEFAULT_PULL_REQUEST_SORT;
  for (let click = 0; click < clicks; click++) {
    sort = nextPullRequestSort({ current: sort, column });
  }
  return sort;
}

describe("the Pull Requests table order", () => {
  describe("given rows nobody has sorted yet", () => {
    /** @scenario "Rows order by their last update by default, pull requests and branches together" */
    it("reads most recently updated first, with branches among the pull requests", () => {
      const rows = [
        row({ headBranch: "oldest-pull-request", lastActivityAtMs: 1_000 }),
        branchRow({ headBranch: "middle-branch", lastActivityAtMs: 2_000 }),
        row({ headBranch: "newest-pull-request", lastActivityAtMs: 3_000 }),
      ];

      expect(
        orderOf(sortPullRequestRows({ rows, sort: DEFAULT_PULL_REQUEST_SORT })),
      ).toEqual(["newest-pull-request", "middle-branch", "oldest-pull-request"]);
    });

    it("opens on the last update, read newest first", () => {
      expect(DEFAULT_PULL_REQUEST_SORT).toEqual({
        column: "lastActivity",
        direction: "desc",
      });
    });
  });

  describe("when a numeric column is chosen", () => {
    /** @scenario "A numeric column sorts largest first on the first click" */
    it("leads with the largest value", () => {
      const rows = [
        row({ headBranch: "small", totalTokens: 1_000 }),
        row({ headBranch: "large", totalTokens: 900_000 }),
        row({ headBranch: "medium", totalTokens: 20_000 }),
      ];
      const sort = afterClicks({ column: "tokens", clicks: 1 });

      expect(sort).toEqual({ column: "tokens", direction: "desc" });
      expect(orderOf(sortPullRequestRows({ rows, sort }))).toEqual([
        "large",
        "medium",
        "small",
      ]);
    });

    it("leads with the largest number for the pull request column too", () => {
      const rows = [
        row({ headBranch: "low", pullRequest: { number: 12, title: "Low" } }),
        row({ headBranch: "high", pullRequest: { number: 4218, title: "Hi" } }),
      ];
      const sort = afterClicks({ column: "number", clicks: 1 });

      expect(orderOf(sortPullRequestRows({ rows, sort }))).toEqual(["high", "low"]);
    });
  });

  describe("when a text column is chosen", () => {
    /** @scenario "A text column sorts A to Z on the first click" */
    it("reads the names A to Z whatever case they were written in", () => {
      const rows = [
        row({
          headBranch: "zebra",
          pullRequest: { number: 1, title: "Zebra crossing" },
        }),
        row({
          headBranch: "apple",
          pullRequest: { number: 2, title: "apple pie" },
        }),
        row({
          headBranch: "middle",
          pullRequest: { number: 3, title: "Middle ground" },
        }),
      ];
      const sort = afterClicks({ column: "title", clicks: 1 });

      expect(sort).toEqual({ column: "title", direction: "asc" });
      expect(orderOf(sortPullRequestRows({ rows, sort }))).toEqual([
        "apple",
        "middle",
        "zebra",
      ]);
    });

    it("falls back to the branch name for a row with no pull request", () => {
      const rows = [
        row({
          headBranch: "zebra",
          pullRequest: { number: 1, title: "Zebra crossing" },
        }),
        branchRow({ headBranch: "aardvark" }),
      ];
      const sort = afterClicks({ column: "title", clicks: 1 });

      expect(orderOf(sortPullRequestRows({ rows, sort }))).toEqual(["aardvark", "zebra"]);
    });
  });

  describe("when the same column is chosen again", () => {
    /** @scenario "A second click flips the order and a third returns to the default" */
    it("reverses on the second choice and returns to the opening order on the third", () => {
      const rows = [
        row({
          headBranch: "small-but-recent",
          totalTokens: 1_000,
          lastActivityAtMs: 3_000,
        }),
        row({
          headBranch: "large-but-old",
          totalTokens: 900_000,
          lastActivityAtMs: 1_000,
        }),
      ];
      const opening = orderOf(
        sortPullRequestRows({ rows, sort: DEFAULT_PULL_REQUEST_SORT }),
      );

      const first = afterClicks({ column: "tokens", clicks: 1 });
      expect(orderOf(sortPullRequestRows({ rows, sort: first }))).toEqual([
        "large-but-old",
        "small-but-recent",
      ]);

      const second = afterClicks({ column: "tokens", clicks: 2 });
      expect(second).toEqual({ column: "tokens", direction: "asc" });
      expect(orderOf(sortPullRequestRows({ rows, sort: second }))).toEqual([
        "small-but-recent",
        "large-but-old",
      ]);

      const third = afterClicks({ column: "tokens", clicks: 3 });
      expect(third).toEqual(DEFAULT_PULL_REQUEST_SORT);
      expect(orderOf(sortPullRequestRows({ rows, sort: third }))).toEqual(opening);
    });

    it("takes the last update column itself from newest, to oldest, and back", () => {
      expect(afterClicks({ column: "lastActivity", clicks: 1 })).toEqual({
        column: "lastActivity",
        direction: "asc",
      });
      expect(afterClicks({ column: "lastActivity", clicks: 2 })).toEqual(
        DEFAULT_PULL_REQUEST_SORT,
      );
    });

    it("starts a different column from its own reading direction", () => {
      const sorted = nextPullRequestSort({
        current: { column: "tokens", direction: "asc" },
        column: "title",
      });

      expect(sorted).toEqual({ column: "title", direction: "asc" });
    });
  });

  describe("when the status column is sorted", () => {
    /** @scenario "Status sorts by the stored snapshot and branches rank last" */
    it("orders by the stored status and keeps branches last whichever way it reads", () => {
      const rows = [
        row({ headBranch: "closed-one", snapshotStatus: "closed" }),
        branchRow({ headBranch: "no-pull-request" }),
        row({ headBranch: "merged-one", snapshotStatus: "merged" }),
        row({ headBranch: "open-one", snapshotStatus: "open" }),
        row({ headBranch: "draft-one", snapshotStatus: "draft" }),
      ];

      const ascending = afterClicks({ column: "status", clicks: 1 });
      expect(ascending).toEqual({ column: "status", direction: "asc" });
      expect(orderOf(sortPullRequestRows({ rows, sort: ascending }))).toEqual([
        "open-one",
        "draft-one",
        "merged-one",
        "closed-one",
        "no-pull-request",
      ]);

      const descending = afterClicks({ column: "status", clicks: 2 });
      expect(orderOf(sortPullRequestRows({ rows, sort: descending }))).toEqual([
        "closed-one",
        "merged-one",
        "draft-one",
        "open-one",
        "no-pull-request",
      ]);
    });
  });

  describe("given rows a column does not apply to", () => {
    it("sinks a row with no pull request number to the bottom either way", () => {
      const rows = [
        branchRow({ headBranch: "no-number" }),
        row({ headBranch: "low", pullRequest: { number: 12, title: "Low" } }),
        row({ headBranch: "high", pullRequest: { number: 99, title: "High" } }),
      ];

      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "number", direction: "desc" },
          }),
        ),
      ).toEqual(["high", "low", "no-number"]);
      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "number", direction: "asc" },
          }),
        ),
      ).toEqual(["low", "high", "no-number"]);
    });

    it("sinks a row with no cost to the bottom either way", () => {
      const rows = [
        row({ headBranch: "unpriced", costUsd: null }),
        row({ headBranch: "cheap", costUsd: 1 }),
        row({ headBranch: "dear", costUsd: 90 }),
      ];

      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "cost", direction: "desc" },
          }),
        ),
      ).toEqual(["dear", "cheap", "unpriced"]);
      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "cost", direction: "asc" },
          }),
        ),
      ).toEqual(["cheap", "dear", "unpriced"]);
    });

    it("sinks a row that called no model to the bottom of the models column", () => {
      const rows = [
        branchRow({ headBranch: "no-model" }),
        row({ headBranch: "zeta", modelBreakdown: [{ model: "zeta-1" }] }),
        row({ headBranch: "alpha", modelBreakdown: [{ model: "Alpha-1" }] }),
      ];

      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "models", direction: "asc" },
          }),
        ),
      ).toEqual(["alpha", "zeta", "no-model"]);
    });

    /** @scenario "A row with only model names sorts by them" */
    it("orders a row that has names but no per-call breakdown among the rest", () => {
      const rows = [
        row({ headBranch: "zeta", modelBreakdown: [{ model: "zeta-1" }] }),
        branchRow({
          headBranch: "named",
          modelBreakdown: [{ model: "Alpha-1" }],
        }),
        branchRow({ headBranch: "no-model" }),
      ];

      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "models", direction: "asc" },
          }),
        ),
      ).toEqual(["named", "zeta", "no-model"]);
    });
  });

  describe("given two rows a column cannot tell apart", () => {
    it("reads the more recently updated of them first", () => {
      const rows = [
        row({
          headBranch: "older",
          totalTokens: 4_000,
          lastActivityAtMs: 1_000,
        }),
        row({
          headBranch: "newer",
          totalTokens: 4_000,
          lastActivityAtMs: 5_000,
        }),
      ];

      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "tokens", direction: "desc" },
          }),
        ),
      ).toEqual(["newer", "older"]);
      expect(
        orderOf(
          sortPullRequestRows({
            rows,
            sort: { column: "tokens", direction: "asc" },
          }),
        ),
      ).toEqual(["newer", "older"]);
    });
  });

  describe("given the rows handed in", () => {
    it("leaves the caller's array untouched", () => {
      const rows = [
        row({ headBranch: "first", lastActivityAtMs: 1_000 }),
        row({ headBranch: "second", lastActivityAtMs: 9_000 }),
      ];

      sortPullRequestRows({ rows, sort: DEFAULT_PULL_REQUEST_SORT });

      expect(orderOf(rows)).toEqual(["first", "second"]);
    });
  });
});
