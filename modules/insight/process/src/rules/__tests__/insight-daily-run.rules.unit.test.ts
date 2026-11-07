/**
 * @vitest-environment node
 * What a run derives from its own identity: its ids, its dates, its title, the insights it
 * lists as open and which of them a finding repeats. Delivery is at least once, so each must
 * come out the same twice.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import type { InsightEntry } from "@langwatch/insight-contract";
import { describe, expect, it } from "vitest";

import {
  dailyRunConversationTitle,
  dailyRunReplay,
  dailyRunWindows,
  dailyScheduleId,
  decideRunFindings,
  matchableInsightsOfBoard,
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
  findingKey: null,
  actions: [],
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

describe("dailyRunReplay", () => {
  it("reads the run's window in hourly steps, with the values a query takes", () => {
    const { window } = dailyRunWindows({ slot: SLOT, timezone: "UTC" });

    expect(dailyRunReplay({ window })).toEqual({
      ...window,
      granularitySeconds: 3_600,
      period: null,
      parameters: {},
    });
    expect(dailyRunReplay({ window, parameters: { model: "gpt-5" } }).parameters).toEqual({
      model: "gpt-5",
    });
  });
});

describe("matchableInsightsOfBoard", () => {
  const boardInsights = (entries: InsightEntry[]) =>
    matchableInsightsOfBoard({ entries, boardId: "dashboard-1", slot: SLOT }).map(({ id }) => id);

  it("holds the board's open and done insights, newest first, and none this run filed", () => {
    const entries = [
      entry({ id: "open", filedAt: SLOT - 2 * DAY_MS }),
      entry({ id: "done", archivedAt: SLOT - 1_000 }),
      entry({ id: "elsewhere", board: { id: "dashboard-2", name: "Latency", widget: null } }),
      entry({ id: "filed-by-this-run", filedAt: SLOT }),
    ];

    expect(boardInsights(entries)).toEqual(["done", "open"]);
  });

  it("holds an insight this run renewed as it held it before, so a retry reads the same", () => {
    const due = entry({ id: "due", filedAt: SLOT - 7 * DAY_MS + 1, validDays: 7 });
    const renewedByThisRun = { ...due, renewedAt: SLOT, validDays: 1 };

    expect(boardInsights([due])).toEqual(["due"]);
    expect(boardInsights([renewedByThisRun])).toEqual(["due"]);
    expect(
      openInsightsOfBoard({ entries: [renewedByThisRun], boardId: "dashboard-1", slot: SLOT }),
    ).toHaveLength(1);
  });
});

describe("decideRunFindings", () => {
  type Words = { title: string; findingKey: string | null; renews: string | null };
  const found = (overrides: Partial<Words> = {}): Words => ({
    title: "Checkout cost doubled",
    findingKey: null,
    renews: null,
    ...overrides,
  });
  /** What each finding does, as "renew <insight id>" or "file <place in the answer>". */
  const decide = ({ findings, entries }: { findings: Words[]; entries: InsightEntry[] }) =>
    decideRunFindings({
      findings,
      insights: matchableInsightsOfBoard({ entries, boardId: "dashboard-1", slot: SLOT }),
    }).map((act) => (act.kind === "renew" ? `renew ${act.insight.id}` : `file ${act.position}`));

  describe("given an open insight of the board", () => {
    const open = entry({ id: "open", findingKey: "checkout-cost-doubled" });

    it("renews it for a finding that names it, and for one that carries its key", () => {
      expect(decide({ findings: [found({ renews: "open" })], entries: [open] })).toEqual([
        "renew open",
      ]);
      expect(
        decide({ findings: [found({ findingKey: "checkout-cost-doubled" })], entries: [open] }),
      ).toEqual(["renew open"]);
    });

    it("takes the insight a finding names before the one that holds its key", () => {
      const other = entry({ id: "other", findingKey: "errors-fell" });
      const findings = [found({ renews: "other", findingKey: "checkout-cost-doubled" })];

      expect(decide({ findings, entries: [open, other] })).toEqual(["renew other"]);
    });

    it("takes the newest of two insights that hold the same key", () => {
      const older = { ...open, id: "older", filedAt: SLOT - 3 * DAY_MS };
      const findings = [found({ findingKey: "checkout-cost-doubled" })];

      expect(decide({ findings, entries: [older, open] })).toEqual(["renew open"]);
    });

    /** @scenario "A finding is never matched by its title" */
    it("files a finding with the same title, another key and no id as new", () => {
      const sameTitle = found({ title: open.title, findingKey: "checkout-cost-rose" });

      expect(decide({ findings: [sameTitle, found()], entries: [open] })).toEqual([
        "file 0",
        "file 1",
      ]);
    });

    /** @scenario "An id that is not the person's own insight for the board is ignored" */
    it("files a finding that names an insight of another board, or no insight, as new", () => {
      const elsewhere = entry({
        id: "elsewhere",
        board: { id: "dashboard-2", name: "Latency", widget: null },
      });
      const findings = [found({ renews: "elsewhere" }), found({ renews: "insight-nobody-has" })];

      expect(decide({ findings, entries: [open, elsewhere] })).toEqual(["file 0", "file 1"]);
    });
  });

  describe("given an insight the person marked done", () => {
    const done = entry({
      id: "done",
      findingKey: "checkout-cost-doubled",
      archivedAt: SLOT - 1_000,
    });

    /** @scenario "A finding that repeats an insight the person marked done does nothing" */
    it("does nothing for a finding that names it or carries its key, and files the rest", () => {
      const findings = [
        found({ renews: "done" }),
        found({ findingKey: "errors-fell" }),
        found({ findingKey: "checkout-cost-doubled" }),
      ];

      expect(decide({ findings, entries: [done] })).toEqual(["file 1"]);
    });
  });

  describe("given an insight whose validity ended before the run and that was not kept", () => {
    const expired = entry({
      id: "expired",
      findingKey: "checkout-cost-doubled",
      filedAt: SLOT - 30 * DAY_MS,
    });

    /** @scenario "A finding that repeats an expired insight is filed as news" */
    it("files a finding that carries its key or names it as new", () => {
      const findings = [
        found({ findingKey: "checkout-cost-doubled" }),
        found({ renews: "expired" }),
      ];

      expect(decide({ findings, entries: [expired] })).toEqual(["file 0", "file 1"]);
    });

    it("renews it when the person kept it, since it is still in their inbox", () => {
      const kept = { ...expired, keptAt: SLOT - DAY_MS };

      expect(decide({ findings: [found({ renews: "expired" })], entries: [kept] })).toEqual([
        "renew expired",
      ]);
    });
  });

  describe("given two findings that repeat one insight and two that share a new key", () => {
    /** @scenario "Two findings for one insight or one key count once" */
    it("renews the insight once, files one insight, and keeps each finding's place", () => {
      const open = entry({ id: "open", findingKey: "checkout-cost-doubled" });
      const findings = [
        found({ renews: "open" }),
        found({ findingKey: "checkout-cost-doubled" }),
        found({ findingKey: "errors-fell" }),
        found({ findingKey: "errors-fell" }),
        found(),
        found(),
      ];

      expect(decide({ findings, entries: [open] })).toEqual([
        "renew open",
        "file 2",
        "file 4",
        "file 5",
      ]);
    });
  });
});
