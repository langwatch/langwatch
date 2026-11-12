// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import {
  runTraceWindowEnd,
  TRACE_WINDOW_END_INTERVAL_MS,
  TRACE_WINDOW_END_PROCESS_NAME,
  traceWindowEndWake,
} from "../nurturing-trace-window-end.process.ts";

const HOUR = TRACE_WINDOW_END_INTERVAL_MS;
const AT = Date.UTC(2026, 10, 20, 12);

/** The wake's context: the slot, and an intent accessor that answers what it was asked. */
const contextAt = (at: number) => ({
  at,
  now: at,
  key: "global",
  projectId: "global",
  intent: (name: string, key: string, payload: unknown) => ({ name, key, payload }) as never,
});

describe("traceWindowEndWake()", () => {
  /** @scenario "The trace traits are removed once when an organization's window ends" */
  it("sweeps from the last wake's slot, so a late wake leaves no gap", () => {
    const evolution = traceWindowEndWake({ lastSweepAt: AT - 3 * HOUR }, contextAt(AT));

    expect(evolution.state).toEqual({ lastSweepAt: AT });
    expect(evolution.intents).toEqual([
      { name: "sweep", key: `sweep:${AT}`, payload: { after: AT - 3 * HOUR, upTo: AT } },
    ]);
  });

  it("sweeps one interval back on its first wake", () => {
    const evolution = traceWindowEndWake({ lastSweepAt: null }, contextAt(AT));

    expect(evolution.intents).toEqual([
      expect.objectContaining({ payload: { after: AT - HOUR, upTo: AT } }),
    ]);
  });
});

describe("runTraceWindowEnd()", () => {
  /** @scenario "The trace traits are removed once when an organization's window ends" */
  it("ends the span's windows, then prunes the sweep's old rows", async () => {
    const calls: unknown[] = [];
    const run = runTraceWindowEnd({
      traceWindowsEnded: async (input) => {
        calls.push(input);
      },
      deleteDispatchedBefore: async (params) => {
        calls.push(params);
        return 0;
      },
      now: () => AT,
    });

    await run({ after: AT - HOUR, upTo: AT });

    expect(calls).toEqual([
      { after: AT - HOUR, upTo: AT },
      { processName: TRACE_WINDOW_END_PROCESS_NAME, before: AT - 7 * 24 * HOUR },
    ]);
  });

  it("throws when the sweep failed, so the outbox retries it", async () => {
    const run = runTraceWindowEnd({
      traceWindowsEnded: () => Promise.reject(new Error("refused")),
      deleteDispatchedBefore: async () => 0,
      now: () => AT,
    });

    await expect(run({ after: AT - HOUR, upTo: AT })).rejects.toThrow("refused");
  });
});
