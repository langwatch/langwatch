/**
 * @vitest-environment node
 * What a run derives from its own identity: its ids, its dates, its title and the insights
 * it must not report again. Delivery is at least once, so each must come out the same twice.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { InsightEntry } from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import {
  dailyRunConversationTitle,
  dailyRunWindows,
  dailyScheduleId,
  openInsightsOfBoard,
  pointerName,
  runInsightId,
} from "../insight-daily-run.rules.ts";

const DAY_MS = 86_400_000;
const SLOT = Date.UTC(2026, 9, 10, 9, 37);

const entry = (overrides: Partial<InsightEntry> = {}): InsightEntry => ({
  id: "insight-1",
  title: "Checkout cost doubled",
  body: "Cost on checkout doubled.",
  tone: "bad",
  topic: null,
  validDays: 7,
  lwql: null,
  replay: null,
  source: null,
  board: { id: "dashboard-1", name: "Costs", widget: null },
  filedVia: "run",
  ownerUserId: "user-1",
  filedByUserId: null,
  filedAt: SLOT - DAY_MS,
  renewedAt: null,
  seenAt: null,
  archivedAt: null,
  keptAt: null,
  ...overrides,
});

describe("dailyRunWindows", () => {
  describe("given a run that started at 09:37 on a day", () => {
    /** @scenario "The run reads the last full day before it started" */
    it("reads the whole day before, and the day before that to compare with", () => {
      expect(dailyRunWindows({ slot: SLOT, timezone: "UTC" })).toEqual({
        window: { start: Date.UTC(2026, 9, 9), end: Date.UTC(2026, 9, 10) },
        previous: { start: Date.UTC(2026, 9, 8), end: Date.UTC(2026, 9, 9) },
      });
    });

    it("reads the day as the timezone counts it", () => {
      const { window } = dailyRunWindows({ slot: SLOT, timezone: "America/New_York" });

      expect(window).toEqual({ start: Date.UTC(2026, 9, 9, 4), end: Date.UTC(2026, 9, 10, 4) });
    });
  });
});

describe("the ids a run derives", () => {
  it("names one schedule per project, person and board", () => {
    const scope = {
      projectId: "project-1",
      userId: "user-1",
      board: { kind: "dashboard", id: "b" },
    } as const;
    const id = dailyScheduleId(scope);

    expect(id).toMatch(/^insightschedule_[0-9a-f]{32}$/);
    expect(dailyScheduleId(scope)).toBe(id);
    expect(dailyScheduleId({ ...scope, userId: "user-2" })).not.toBe(id);
    expect(dailyScheduleId({ ...scope, projectId: "project-2" })).not.toBe(id);
    expect(dailyScheduleId({ ...scope, board: { kind: "template", id: "b" } })).not.toBe(id);
  });

  it("names the same insight for the same run and position, and another for any other", () => {
    const at = { scheduleId: "schedule-1", runId: "run-1", position: 0 };
    const id = runInsightId(at);

    expect(runInsightId(at)).toBe(id);
    expect(runInsightId({ ...at, position: 1 })).not.toBe(id);
    expect(runInsightId({ ...at, runId: "run-2" })).not.toBe(id);
  });
});

describe("dailyRunConversationTitle", () => {
  it("names the board and the day the run read, on one line", () => {
    const { window } = dailyRunWindows({ slot: SLOT, timezone: "UTC" });

    expect(
      dailyRunConversationTitle({ boardName: "Costs\nand errors", window, timezone: "UTC" }),
    ).toBe("Daily insights - Costs and errors - 2026-10-09");
  });
});

describe("pointerName", () => {
  it("keeps a name on one line within the pointer's limit, and falls back when it is empty", () => {
    expect(pointerName({ name: "  Costs\n per day ", fallback: "id-1" })).toBe("Costs per day");
    expect(pointerName({ name: "x".repeat(255), fallback: "id-1" })).toHaveLength(200);
    expect(pointerName({ name: " \n ", fallback: "id-1" })).toBe("id-1");
  });
});

describe("openInsightsOfBoard", () => {
  describe("given the person has an open insight, a done insight and an insight from another board", () => {
    /** @scenario "The brief lists the person's open insights for the board" */
    it("lists the open insight of this board and neither of the others", () => {
      const entries = [
        entry({ id: "open" }),
        entry({ id: "done", archivedAt: SLOT - 1_000 }),
        entry({ id: "elsewhere", board: { id: "dashboard-2", name: "Latency", widget: null } }),
        entry({ id: "no-board", board: null }),
      ];

      const open = openInsightsOfBoard({ entries, boardId: "dashboard-1", slot: SLOT });

      expect(open.map(({ id }) => id)).toEqual(["open"]);
    });

    it("leaves out a stale insight, and keeps one the person kept", () => {
      const entries = [
        entry({ id: "stale", filedAt: SLOT - 30 * DAY_MS }),
        entry({ id: "kept", filedAt: SLOT - 30 * DAY_MS, keptAt: SLOT - DAY_MS }),
      ];

      const open = openInsightsOfBoard({ entries, boardId: "dashboard-1", slot: SLOT });

      expect(open.map(({ id }) => id)).toEqual(["kept"]);
    });

    it("leaves out what this very run filed, so a retry lists the same insights", () => {
      const entries = [entry({ id: "filed-by-this-run", filedAt: SLOT }), entry({ id: "before" })];

      const open = openInsightsOfBoard({ entries, boardId: "dashboard-1", slot: SLOT });

      expect(open.map(({ id }) => id)).toEqual(["before"]);
    });

    it("lists the newest first", () => {
      const entries = [
        entry({ id: "older", filedAt: SLOT - 3 * DAY_MS }),
        entry({ id: "newer", filedAt: SLOT - DAY_MS }),
      ];

      const open = openInsightsOfBoard({ entries, boardId: "dashboard-1", slot: SLOT });

      expect(open.map(({ id }) => id)).toEqual(["newer", "older"]);
    });
  });
});
