/**
 * The managed prompt version floor each ledger state of its replay step answers.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */
import type { LedgerStepRecord } from "@langwatch/upgrade/reader";
import { describe, expect, it } from "vitest";

import { managedPromptVersionFloorOf } from "../managed-prompt-version-floor.rules.ts";

const SINCE = "2026-07-18T00:00:00Z";
const STARTED = "2026-11-17T10:00:00Z";
const REBUILDING = { from: null, rebuilding: true, unknown: false };
const UNKNOWN = { from: null, rebuilding: false, unknown: true };

describe("managedPromptVersionFloorOf", () => {
  /** @scenario "A period reaching before the replay's start shows its rows and says from when versions are known" */
  it("is the recorded since once the replay is done", () => {
    expect(
      managedPromptVersionFloorOf([
        { status: "done", report: { replayedSince: SINCE }, startedAt: STARTED },
      ]),
    ).toEqual({ from: SINCE, rebuilding: false, unknown: false });
  });

  const notYetDone: [string, LedgerStepRecord[]][] = [
    ["no ledger row", []],
    ["a pending row", [{ status: "pending", report: null, startedAt: null }]],
    ["a gated row", [{ status: "gated", report: null, startedAt: null }]],
    [
      "a running row",
      [{ status: "running", report: { replayedSince: SINCE }, startedAt: STARTED }],
    ],
  ];

  /** @scenario "A widget reading the managed version says history is rebuilding until the replay is done" */
  it.each(notYetDone)(
    "is rebuilding with %s, even once a running replay records its since",
    (_, rows) => {
      expect(managedPromptVersionFloorOf(rows)).toEqual(REBUILDING);
    },
  );

  /** @scenario "A replay that failed after its retries shows the history as unknown, never the rows" */
  it("is unknown when the replay failed after its retries", () => {
    expect(
      managedPromptVersionFloorOf([
        { status: "failed", report: { replayedSince: SINCE }, startedAt: STARTED },
      ]),
    ).toEqual(UNKNOWN);
  });

  it("is unknown, never whole, when a done replay recorded no since", () => {
    expect(
      managedPromptVersionFloorOf([{ status: "done", report: null, startedAt: STARTED }]),
    ).toEqual(UNKNOWN);
  });

  it("is whole on a fresh install, where the replay is not needed", () => {
    expect(
      managedPromptVersionFloorOf([{ status: "not-needed", report: null, startedAt: null }]),
    ).toEqual({ from: null, rebuilding: false, unknown: false });
  });
});
