// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import {
  runTraceWindowEnd,
  TRACE_WINDOW_END_INTERVAL_MS,
  TRACE_WINDOW_END_PROCESS_NAME,
  traceWindowEndWake,
} from "../nurturing-trace-window-end.process.ts";
import { foldLive, spanReceived, traceFailed } from "./nurturing-trace-days.test-helpers.ts";

const HOUR = TRACE_WINDOW_END_INTERVAL_MS;
const AT = Date.UTC(2026, 10, 20, 12);
const DAY = 24 * HOUR;

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
  it("ends the span's windows, then prunes old trace days and the sweep's old rows", async () => {
    const calls: unknown[] = [];
    const run = runTraceWindowEnd({
      traceWindowsEnded: async (input) => {
        calls.push(input);
      },
      pruneTraceDaysBefore: async (input) => {
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
      { beforeDay: "2026-10-21" },
      { processName: TRACE_WINDOW_END_PROCESS_NAME, before: AT - 7 * 24 * HOUR },
    ]);
  });

  it("throws when the sweep failed, so the outbox retries it", async () => {
    const run = runTraceWindowEnd({
      traceWindowsEnded: () => Promise.reject(new Error("refused")),
      pruneTraceDaysBefore: async () => undefined,
      deleteDispatchedBefore: async () => 0,
      now: () => AT,
    });

    await expect(run({ after: AT - HOUR, upTo: AT })).rejects.toThrow("refused");
  });

  /** @scenario "The hourly sweep drops every trace day older than the usage window" */
  it("drops every project's trace days older than the usage window, synced or not", async () => {
    const traceDays = MemoryNurturingTraceDayRepository.create();
    await foldLive({
      spans: traceDays.forSource("spans"),
      failures: traceDays.forSource("failures"),
      facts: [
        spanReceived({
          id: "old-never-synced",
          projectId: "project-quiet",
          createdAt: AT - 31 * DAY,
        }),
        traceFailed({ id: "old-synced", projectId: "project-1", createdAt: AT - 40 * DAY }),
        spanReceived({ id: "recent", projectId: "project-1", createdAt: AT - DAY }),
      ],
    });
    const run = runTraceWindowEnd({
      traceWindowsEnded: async () => undefined,
      pruneTraceDaysBefore: (input) => traceDays.pruneEveryProjectBefore(input),
      deleteDispatchedBefore: async () => 0,
      now: () => AT,
    });

    await run({ after: AT - HOUR, upTo: AT });

    const kept = await traceDays.findForProjects({
      projectIds: ["project-quiet", "project-1"],
      afterDay: "",
    });
    expect(kept.map(({ projectId, day }) => [projectId, day])).toEqual([
      ["project-1", "2026-11-19"],
    ]);
  });

  /** @scenario "The hourly sweep drops every trace day older than the usage window" */
  it("logs a failed prune and leaves it to the next sweep, without failing this one", async () => {
    const pruned: unknown[] = [];
    const run = runTraceWindowEnd({
      traceWindowsEnded: async () => undefined,
      pruneTraceDaysBefore: () => Promise.reject(new Error("locked")),
      deleteDispatchedBefore: async (params) => {
        pruned.push(params);
        return 0;
      },
      now: () => AT,
    });

    await expect(run({ after: AT - HOUR, upTo: AT })).resolves.toBeUndefined();
    expect(pruned).toHaveLength(1);
  });
});
