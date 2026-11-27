/**
 * A widget reading the managed prompt version shows its rows once the replay is done, or when there
 * is nothing to replay, with a note when its window reaches before the known history. Otherwise a
 * notice. The server maps the ledger rows (none, pending, running, done, not-needed, failed).
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */

import { describe, expect, it } from "vitest";

import {
  managedPromptVersionGate,
  type ManagedPromptVersionFloorRead,
  readsManagedPromptVersionFromTraceMetrics,
} from "../managed-prompt-version-floor.ts";

const DAY_MS = 86_400_000;
const SINCE = "2026-07-18T00:00:00Z";
const SINCE_MS = Date.parse(SINCE);

/** A 60-day period whose window, with the period before it, starts `offsetDays` after SINCE. */
const periodWhoseWindowStarts = (offsetDays: number) => {
  const windowStart = SINCE_MS + offsetDays * DAY_MS;
  return { start: windowStart + 60 * DAY_MS, end: windowStart + 120 * DAY_MS };
};

const read = (floor: {
  from: string | null;
  rebuilding: boolean;
  unknown: boolean;
}): ManagedPromptVersionFloorRead => ({ status: "read", floor });

const REBUILDING = read({ from: null, rebuilding: true, unknown: false });
const DONE = read({ from: SINCE, rebuilding: false, unknown: false });
const NOT_NEEDED = read({ from: null, rebuilding: false, unknown: false });
const LEDGER_FAILED = read({ from: null, rebuilding: false, unknown: true });

describe("managedPromptVersionGate", () => {
  /** @scenario "A widget reading the managed version says history is rebuilding until the replay is done" */
  it("says history is being rebuilt, body hidden, for no row, a pending or a running row", () => {
    expect(
      managedPromptVersionGate({ read: REBUILDING, timeWindow: periodWhoseWindowStarts(30) }),
    ).toEqual({ kind: "notice", notice: "Prompt version history is still being rebuilt" });
  });

  it("shows the body once done, when the window starts at the since", () => {
    expect(
      managedPromptVersionGate({ read: DONE, timeWindow: periodWhoseWindowStarts(0) }),
    ).toEqual({ kind: "body" });
  });

  it("shows the body once done, when the window starts after the since", () => {
    expect(
      managedPromptVersionGate({ read: DONE, timeWindow: periodWhoseWindowStarts(1) }),
    ).toEqual({ kind: "body" });
  });

  /** @scenario "A period reaching before the replay's start shows its rows and says from when versions are known" */
  it("shows the body with a note once done, when the window starts before the since", () => {
    expect(
      managedPromptVersionGate({ read: DONE, timeWindow: periodWhoseWindowStarts(-1) }),
    ).toEqual({ kind: "body", note: "Prompt versions known from 18 Jul 2026" });
  });

  it("counts the previous period: a period inside the history whose previous one is not", () => {
    const period = { start: SINCE_MS + 10 * DAY_MS, end: SINCE_MS + 70 * DAY_MS };

    expect(managedPromptVersionGate({ read: DONE, timeWindow: period })).toEqual({
      kind: "body",
      note: "Prompt versions known from 18 Jul 2026",
    });
  });

  describe("given the 122-day replay finished today", () => {
    const now = SINCE_MS + 122 * DAY_MS;
    const lastDays = (days: number) => ({ start: now - days * DAY_MS, end: now });

    it("shows the body without a note for a 30d board, whose window fits in the history", () => {
      expect(managedPromptVersionGate({ read: DONE, timeWindow: lastDays(30) })).toEqual({
        kind: "body",
      });
    });

    /** @scenario "A period reaching before the replay's start shows its rows and says from when versions are known" */
    it.each([
      ["90d", 90],
      ["1y", 365],
    ])(
      "keeps the body of a %s board, whose window reaches past the history, and notes it",
      (_, days) => {
        expect(managedPromptVersionGate({ read: DONE, timeWindow: lastDays(days) })).toEqual({
          kind: "body",
          note: "Prompt versions known from 18 Jul 2026",
        });
      },
    );
  });

  it("shows the body on a fresh install, where the replay is not needed", () => {
    expect(
      managedPromptVersionGate({ read: NOT_NEEDED, timeWindow: periodWhoseWindowStarts(-400) }),
    ).toEqual({ kind: "body" });
  });

  /** @scenario "A replay that failed after its retries shows the history as unknown, never the rows" */
  it("says history is unknown when the floor read failed", () => {
    expect(
      managedPromptVersionGate({
        read: { status: "failed" },
        timeWindow: periodWhoseWindowStarts(30),
      }),
    ).toEqual({ kind: "notice", notice: "Prompt version history unknown" });
  });

  /** @scenario "A replay that failed after its retries shows the history as unknown, never the rows" */
  it("says history is unknown, body hidden, when the ledger row is failed or unreadable", () => {
    expect(
      managedPromptVersionGate({ read: LEDGER_FAILED, timeWindow: periodWhoseWindowStarts(30) }),
    ).toEqual({ kind: "notice", notice: "Prompt version history unknown" });
  });

  it("shows no notice and holds the body back while the floor loads", () => {
    expect(
      managedPromptVersionGate({
        read: { status: "loading" },
        timeWindow: periodWhoseWindowStarts(30),
      }),
    ).toEqual({ kind: "loading" });
  });
});

/** ck-trend's and ext-cost-per-doc's shape: the column from traces, beside trace_metrics reads. */
const COLUMN_FROM_TRACES_BESIDE_TRACE_METRICS = `SELECT kind, name FROM (
  SELECT 'model' AS kind, arrayJoin(Models) AS name FROM trace_metrics
  UNION ALL
  SELECT 'prompt' AS kind, name FROM (
    SELECT LastUsedPromptVersionId AS name FROM traces WHERE LastUsedPromptVersionId != ''
    UNION ALL
    SELECT MetadataPromptVersion AS name FROM trace_metrics
    WHERE cityHash64(TraceId) NOT IN (
      SELECT cityHash64(TraceId) FROM traces WHERE LastUsedPromptVersionId != ''
    )
  )
)
WHERE first_at > (SELECT min(OccurredAt) FROM trace_metrics)`;

/** att-change's shape: the column from trace_metrics in one UNION branch of a subquery. */
const COLUMN_FROM_TRACE_METRICS_IN_A_UNION = `SELECT version FROM (
  SELECT MetadataPromptVersion AS version FROM trace_metrics WHERE MetadataPromptVersion != ''
  UNION ALL
  SELECT LastUsedPromptVersionId AS version FROM trace_metrics
  WHERE LastUsedPromptVersionId != ''
    AND cityHash64(TraceId) NOT IN (SELECT cityHash64(TraceId) FROM trace_metrics)
)`;

describe("readsManagedPromptVersionFromTraceMetrics", () => {
  it.each([
    ["SELECT LastUsedPromptVersionId FROM trace_metrics", true],
    ["SELECT any(t.LastUsedPromptVersionId) AS v FROM trace_metrics AS t", true],
    ["SELECT LastUsedPromptVersionId FROM analytics.trace_metrics", true],
    ["SELECT LastUsedPromptVersionId FROM langwatch.trace_metrics", true],
    [
      "SELECT m.LastUsedPromptVersionId FROM traces AS t JOIN trace_metrics AS m USING TraceId",
      true,
    ],
    ["SELECT MetadataPromptVersion FROM trace_metrics", false],
    ["SELECT LastUsedPromptVersionIds FROM trace_metrics", false],
    ["SELECT LastUsedPromptVersionId FROM traces", false],
    ["SELECT count() FROM trace_metrics -- not LastUsedPromptVersionId", false],
  ])("reads %s as %s", (sql, expected) => {
    expect(readsManagedPromptVersionFromTraceMetrics([{ sql }])).toBe(expected);
  });

  it("does not gate a query reading the column only from traces, beside trace_metrics reads", () => {
    expect(
      readsManagedPromptVersionFromTraceMetrics([{ sql: COLUMN_FROM_TRACES_BESIDE_TRACE_METRICS }]),
    ).toBe(false);
  });

  it("does not gate the column and trace_metrics in different UNION branches", () => {
    const sql = `SELECT LastUsedPromptVersionId AS name FROM traces
UNION ALL
SELECT MetadataPromptVersion AS name FROM trace_metrics`;

    expect(readsManagedPromptVersionFromTraceMetrics([{ sql }])).toBe(false);
  });

  it("does not gate the column and trace_metrics in different subqueries", () => {
    const sql = `SELECT count() FROM trace_metrics WHERE TraceId IN (
  SELECT TraceId FROM traces WHERE LastUsedPromptVersionId != ''
)`;

    expect(readsManagedPromptVersionFromTraceMetrics([{ sql }])).toBe(false);
  });

  it("gates a query reading the column from trace_metrics in one branch of a union", () => {
    expect(
      readsManagedPromptVersionFromTraceMetrics([{ sql: COLUMN_FROM_TRACE_METRICS_IN_A_UNION }]),
    ).toBe(true);
  });

  it.each(["Name != '('", "Name != 'it''s ('", "Name != 'it\\'s ('"])(
    "reads the parenthesis in %s as text, not structure",
    (filter) => {
      const sql = `SELECT name FROM (
  SELECT TraceId, LastUsedPromptVersionId AS name FROM traces WHERE ${filter}
) AS t
INNER JOIN trace_metrics AS m ON m.TraceId = t.TraceId`;

      expect(readsManagedPromptVersionFromTraceMetrics([{ sql }])).toBe(false);
    },
  );

  it("gates the column from trace_metrics when a literal before its FROM holds ')'", () => {
    const sql = `SELECT version FROM (
  SELECT if(Name = ')', '', LastUsedPromptVersionId) AS version FROM trace_metrics
)`;

    expect(readsManagedPromptVersionFromTraceMetrics([{ sql }])).toBe(true);
  });

  it("gates a widget when any one of its queries reads the column from trace_metrics", () => {
    expect(
      readsManagedPromptVersionFromTraceMetrics([
        { sql: COLUMN_FROM_TRACES_BESIDE_TRACE_METRICS },
        { sql: COLUMN_FROM_TRACE_METRICS_IN_A_UNION },
      ]),
    ).toBe(true);
  });
});
