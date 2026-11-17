/**
 * A widget reading the managed prompt version shows its rows only once they cannot be wrong: the
 * replay done and its window inside the known history, or nothing to replay. Otherwise a notice.
 * The server maps the ledger rows (none, pending, running, done, not-needed, failed) to the floor.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */

import { describe, expect, it } from "vitest";

import {
  managedPromptVersionGate,
  type ManagedPromptVersionFloorRead,
  readsManagedPromptVersion,
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

  /** @scenario "A period reaching before the replay's start says from when versions are known" */
  it("says from when versions are known once done, when the window starts before the since", () => {
    expect(
      managedPromptVersionGate({ read: DONE, timeWindow: periodWhoseWindowStarts(-1) }),
    ).toEqual({ kind: "notice", notice: "Prompt versions known from 18 Jul 2026" });
  });

  it("counts the previous period: a period inside the history whose previous one is not", () => {
    const period = { start: SINCE_MS + 10 * DAY_MS, end: SINCE_MS + 70 * DAY_MS };

    expect(managedPromptVersionGate({ read: DONE, timeWindow: period })).toEqual({
      kind: "notice",
      notice: "Prompt versions known from 18 Jul 2026",
    });
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

describe("readsManagedPromptVersion", () => {
  it.each([
    ["SELECT LastUsedPromptVersionId FROM trace_metrics", true],
    ["SELECT any(t.LastUsedPromptVersionId) AS v FROM trace_metrics AS t", true],
    ["SELECT MetadataPromptVersion FROM trace_metrics", false],
    ["SELECT LastUsedPromptVersionIds FROM trace_metrics", false],
  ])("reads %s as %s", (sql, expected) => {
    expect(readsManagedPromptVersion([{ sql }])).toBe(expected);
  });
});
