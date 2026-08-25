/**
 * @vitest-environment node
 * @unit
 *
 * The Sessions table's order: what it opens on, what each column does with the
 * first, second and third click, and where a row a column does not apply to
 * ends up.
 *
 * @see specs/coding-agent/sessions-screen.feature
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSIONS_SORT,
  nextSessionsSort,
  type SessionsSortColumn,
  type SessionsSortState,
  type SortableSessionRow,
  sessionLastUpdateAtMs,
  sessionTotalTokens,
  sortSessionRows,
} from "../src/session-sort";

/**
 * One sortable row, filled in around whatever a case pins. Every fixture names
 * itself by its branch, which is the one field every row carries, so the order
 * a case asserts reads as a list of names.
 */
function row(
  over: Partial<SortableSessionRow> & { gitBranch: string },
): SortableSessionRow {
  return {
    title: "A generated title",
    agent: "claude_code",
    lastUpdateAtMs: 1_000,
    totalTokens: 1_000,
    compactions: 1,
    activeTimeCliSec: 60,
    costUsd: 1,
    pullRequests: [{ number: 100 }],
    ...over,
  };
}

const orderOf = (rows: readonly SortableSessionRow[]) =>
  rows.map((each) => each.gitBranch);

/** The state a column lands in after `clicks` clicks, starting from default. */
function afterClicks({
  column,
  clicks,
}: {
  column: SessionsSortColumn;
  clicks: number;
}): SessionsSortState {
  let sort: SessionsSortState = DEFAULT_SESSIONS_SORT;
  for (let click = 0; click < clicks; click++) {
    sort = nextSessionsSort({ current: sort, column });
  }
  return sort;
}

describe("the Sessions table order", () => {
  describe("given rows nobody has sorted yet", () => {
    it("opens on the last update, read newest first", () => {
      expect(DEFAULT_SESSIONS_SORT).toEqual({
        column: "lastUpdate",
        direction: "desc",
      });
    });

    it("reads the most recently updated session first", () => {
      const rows = [
        row({ gitBranch: "oldest", lastUpdateAtMs: 1_000 }),
        row({ gitBranch: "newest", lastUpdateAtMs: 3_000 }),
        row({ gitBranch: "middle", lastUpdateAtMs: 2_000 }),
      ];

      expect(
        orderOf(sortSessionRows({ rows, sort: DEFAULT_SESSIONS_SORT })),
      ).toEqual(["newest", "middle", "oldest"]);
    });
  });

  describe("when a measured column is chosen", () => {
    it("leads with the heaviest session on the context column", () => {
      const rows = [
        row({ gitBranch: "small", totalTokens: 1_000 }),
        row({ gitBranch: "large", totalTokens: 900_000 }),
        row({ gitBranch: "medium", totalTokens: 20_000 }),
      ];
      const sort = afterClicks({ column: "context", clicks: 1 });

      expect(sort).toEqual({ column: "context", direction: "desc" });
      expect(orderOf(sortSessionRows({ rows, sort }))).toEqual([
        "large",
        "medium",
        "small",
      ]);
    });

    it("leads with the most compactions", () => {
      const rows = [
        row({ gitBranch: "calm", compactions: 0 }),
        row({ gitBranch: "churned", compactions: 7 }),
      ];
      const sort = afterClicks({ column: "compactions", clicks: 1 });

      expect(orderOf(sortSessionRows({ rows, sort }))).toEqual([
        "churned",
        "calm",
      ]);
    });

    it("leads with the longest working session", () => {
      const rows = [
        row({ gitBranch: "quick", activeTimeCliSec: 30 }),
        row({ gitBranch: "long-haul", activeTimeCliSec: 15_120 }),
      ];
      const sort = afterClicks({ column: "activeTime", clicks: 1 });

      expect(orderOf(sortSessionRows({ rows, sort }))).toEqual([
        "long-haul",
        "quick",
      ]);
    });
  });

  describe("when the session column is chosen", () => {
    it("reads the titles A to Z whatever case they were written in", () => {
      const rows = [
        row({ gitBranch: "zebra", title: "Zebra crossing" }),
        row({ gitBranch: "apple", title: "apple pie" }),
        row({ gitBranch: "middle", title: "Middle ground" }),
      ];
      const sort = afterClicks({ column: "session", clicks: 1 });

      expect(sort).toEqual({ column: "session", direction: "asc" });
      expect(orderOf(sortSessionRows({ rows, sort }))).toEqual([
        "apple",
        "middle",
        "zebra",
      ]);
    });

    it("falls back to the branch name for a session with no title", () => {
      const rows = [
        row({ gitBranch: "zebra", title: "Zebra crossing" }),
        row({ gitBranch: "aardvark", title: null }),
      ];
      const sort = afterClicks({ column: "session", clicks: 1 });

      expect(orderOf(sortSessionRows({ rows, sort }))).toEqual([
        "aardvark",
        "zebra",
      ]);
    });
  });

  describe("when the same column is chosen again", () => {
    it("reverses on the second choice and returns to the opening order on the third", () => {
      const rows = [
        row({
          gitBranch: "small-but-recent",
          totalTokens: 1_000,
          lastUpdateAtMs: 3_000,
        }),
        row({
          gitBranch: "large-but-old",
          totalTokens: 900_000,
          lastUpdateAtMs: 1_000,
        }),
      ];
      const opening = orderOf(
        sortSessionRows({ rows, sort: DEFAULT_SESSIONS_SORT }),
      );

      const first = afterClicks({ column: "context", clicks: 1 });
      expect(orderOf(sortSessionRows({ rows, sort: first }))).toEqual([
        "large-but-old",
        "small-but-recent",
      ]);

      const second = afterClicks({ column: "context", clicks: 2 });
      expect(second).toEqual({ column: "context", direction: "asc" });
      expect(orderOf(sortSessionRows({ rows, sort: second }))).toEqual([
        "small-but-recent",
        "large-but-old",
      ]);

      const third = afterClicks({ column: "context", clicks: 3 });
      expect(third).toEqual(DEFAULT_SESSIONS_SORT);
      expect(orderOf(sortSessionRows({ rows, sort: third }))).toEqual(opening);
    });

    it("takes the last update column itself from newest, to oldest, and back", () => {
      expect(afterClicks({ column: "lastUpdate", clicks: 1 })).toEqual({
        column: "lastUpdate",
        direction: "asc",
      });
      expect(afterClicks({ column: "lastUpdate", clicks: 2 })).toEqual(
        DEFAULT_SESSIONS_SORT,
      );
    });

    it("starts a different column from its own reading direction", () => {
      expect(
        nextSessionsSort({
          current: { column: "context", direction: "asc" },
          column: "session",
        }),
      ).toEqual({ column: "session", direction: "asc" });
    });
  });

  describe("when the pull requests column is chosen", () => {
    it("ranks a session by the lowest pull request it drove", () => {
      const rows = [
        row({ gitBranch: "later", pullRequests: [{ number: 4300 }] }),
        row({
          gitBranch: "earlier",
          pullRequests: [{ number: 4218 }, { number: 4400 }],
        }),
      ];

      expect(
        orderOf(
          sortSessionRows({
            rows,
            sort: { column: "pullRequests", direction: "asc" },
          }),
        ),
      ).toEqual(["earlier", "later"]);
    });
  });

  describe("given rows a column does not apply to", () => {
    it("sinks a session that drove no pull request to the bottom either way", () => {
      const rows = [
        row({ gitBranch: "none", pullRequests: [] }),
        row({ gitBranch: "low", pullRequests: [{ number: 12 }] }),
        row({ gitBranch: "high", pullRequests: [{ number: 99 }] }),
      ];

      expect(
        orderOf(
          sortSessionRows({
            rows,
            sort: { column: "pullRequests", direction: "desc" },
          }),
        ),
      ).toEqual(["high", "low", "none"]);
      expect(
        orderOf(
          sortSessionRows({
            rows,
            sort: { column: "pullRequests", direction: "asc" },
          }),
        ),
      ).toEqual(["low", "high", "none"]);
    });

    it("sinks a session with no cost to the bottom either way", () => {
      const rows = [
        row({ gitBranch: "unpriced", costUsd: null }),
        row({ gitBranch: "cheap", costUsd: 1 }),
        row({ gitBranch: "dear", costUsd: 90 }),
      ];

      expect(
        orderOf(
          sortSessionRows({
            rows,
            sort: { column: "cost", direction: "desc" },
          }),
        ),
      ).toEqual(["dear", "cheap", "unpriced"]);
      expect(
        orderOf(
          sortSessionRows({ rows, sort: { column: "cost", direction: "asc" } }),
        ),
      ).toEqual(["cheap", "dear", "unpriced"]);
    });

    it("sinks a session that never named its agent to the bottom", () => {
      const rows = [
        row({ gitBranch: "unnamed", agent: "" }),
        row({ gitBranch: "zeta", agent: "zeta_agent" }),
        row({ gitBranch: "alpha", agent: "Alpha_agent" }),
      ];

      expect(
        orderOf(
          sortSessionRows({
            rows,
            sort: { column: "agent", direction: "asc" },
          }),
        ),
      ).toEqual(["alpha", "zeta", "unnamed"]);
    });
  });

  describe("given two rows a column cannot tell apart", () => {
    it("reads the more recently updated of them first", () => {
      const rows = [
        row({ gitBranch: "older", compactions: 4, lastUpdateAtMs: 1_000 }),
        row({ gitBranch: "newer", compactions: 4, lastUpdateAtMs: 5_000 }),
      ];

      expect(
        orderOf(
          sortSessionRows({
            rows,
            sort: { column: "compactions", direction: "desc" },
          }),
        ),
      ).toEqual(["newer", "older"]);
      expect(
        orderOf(
          sortSessionRows({
            rows,
            sort: { column: "compactions", direction: "asc" },
          }),
        ),
      ).toEqual(["newer", "older"]);
    });
  });

  describe("given the rows handed in", () => {
    it("leaves the caller's array untouched", () => {
      const rows = [
        row({ gitBranch: "first", lastUpdateAtMs: 1_000 }),
        row({ gitBranch: "second", lastUpdateAtMs: 9_000 }),
      ];

      sortSessionRows({ rows, sort: DEFAULT_SESSIONS_SORT });

      expect(orderOf(rows)).toEqual(["first", "second"]);
    });
  });

  describe("given a session that never produced an event", () => {
    it("reads its last update off the moment it started", () => {
      expect(
        sessionLastUpdateAtMs({
          lastEventOccurredAtMs: 0,
          startedAtMs: 7_000,
        }),
      ).toBe(7_000);
      expect(
        sessionLastUpdateAtMs({
          lastEventOccurredAtMs: 9_000,
          startedAtMs: 7_000,
        }),
      ).toBe(9_000);
    });
  });

  describe("given a session's four token counters", () => {
    it("counts the cached tokens toward the total alongside the live ones", () => {
      expect(
        sessionTotalTokens({
          inputTokens: 1,
          outputTokens: 20,
          cacheReadTokens: 300,
          cacheCreationTokens: 4_000,
        }),
      ).toBe(4_321);
    });
  });
});
