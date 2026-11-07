/**
 * @vitest-environment node
 * A run that finds again what an earlier run filed, end to end on a memory worker: the real
 * pipeline and process, Langy scripted, and the clock moved between two runs a day apart.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  deriveInsightInbox,
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_EVENT_TYPES,
  type InsightRunBoard,
} from "@langwatch/insight-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dailyRunWindows } from "../../rules/insight-daily-run.rules.ts";
import {
  answerWith,
  BOARD,
  COST_QUERY,
  ERRORS_QUERY,
  finding,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
  OTHER_MEMBER,
} from "./insight-daily-run.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

const { FILED, RENEWED, ARCHIVED } = INSIGHT_EVENT_TYPES;
const { RUN_REQUESTED, RUN_STARTED, RUN_SETTLED } = INSIGHT_DAILY_RUN_EVENT_TYPES;
const HOUR_MS = 3_600_000;
const DAY_1 = Date.UTC(2026, 9, 10, 9, 37);
const DAY_2 = DAY_1 + 24 * HOUR_MS;

let installed: InstalledDailyRuns;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DAY_1);
  installed = await installDailyRuns();
});

afterEach(async () => {
  vi.useRealTimers();
  await installed.stop();
});

type RunScope = { userId?: string; board?: InsightRunBoard };

/** Carries out one run at `now` with the findings Langy answers, and hands back its intent. */
async function runAt({
  now,
  findings,
  userId = MEMBER,
  board = BOARD,
}: RunScope & { now: number; findings: readonly Record<string, unknown>[] }) {
  vi.setSystemTime(now);
  installed.world.langy.answer = answerWith(findings);
  const { requestId } = await installed.app.requestDailyRun({ projectId: PROJECT, userId, board });
  const intent = (await installed.intentsOf({ userId, board })).find(({ payload }) => {
    return (payload as { runId?: string }).runId === requestId;
  });
  if (!intent) throw new Error(`The schedule wrote no intent for request ${requestId}`);
  await installed.carryOut(intent.payload);
  return intent.payload;
}

const insightsOf = (userId = MEMBER) => installed.app.findInsights({ projectId: PROJECT, userId });
const eventsOf = (insightId: string) => installed.eventTypesOf({ projectId: PROJECT, insightId });

/** The person's one insight with this title. */
async function insightTitled(title: string, userId = MEMBER) {
  const found = (await insightsOf(userId)).find((entry) => entry.title === title);
  if (!found) throw new Error(`No insight is titled ${title}`);
  return found;
}

/** How the person's last run on the board ended. */
async function lastRunOf({ userId = MEMBER, board = BOARD }: RunScope = {}) {
  const id = installed.scheduleIdOf({ userId, board });
  const runs = await installed.app.findDailyRuns({ projectId: PROJECT, userId });
  return runs.find((candidate) => candidate.id === id)?.lastRun ?? null;
}

const COST = finding({ key: "checkout-cost-doubled" });
const ERRORS = finding({
  title: "Errors rose on search",
  tone: "watch",
  key: "search-errors-rose",
});

describe("given Langy answers a finding with a key that none of the person's insights holds", () => {
  /** @scenario "A new finding is filed with its key" */
  it("files one insight that holds the key in one spelling, and renews none", async () => {
    await runAt({ now: DAY_1, findings: [finding({ key: "Checkout cost doubled" })] });

    expect(await insightsOf()).toEqual([
      expect.objectContaining({ findingKey: "checkout-cost-doubled", renewedAt: null }),
    ]);
    expect(await lastRunOf()).toMatchObject({ outcome: "filed", filedCount: 1, renewedCount: 0 });
  });
});

describe("given the person has an open insight for the board from an earlier run", () => {
  describe("when a later run's finding names that insight as the one it repeats", () => {
    /** @scenario "A finding that names an open insight renews it and files nothing" */
    it("renews it once on the same id with the later run's words, and files nothing", async () => {
      await runAt({ now: DAY_1, findings: [finding()] });
      const filed = await insightTitled("Checkout cost doubled");

      await runAt({
        now: DAY_2,
        findings: [
          finding({
            title: "Checkout cost is still double",
            body: "Cost on checkout stayed at 96 dollars.",
            tone: "watch",
            validDays: 3,
            renews: filed.id,
          }),
        ],
      });

      expect(await insightsOf()).toEqual([
        {
          ...filed,
          body: "Cost on checkout stayed at 96 dollars.",
          tone: "watch",
          validDays: 3,
          source: { conversationId: "conversation-2", messageId: "message-of-turn-2" },
          renewedAt: DAY_2,
        },
      ]);
      expect(filed).toMatchObject({ tone: "bad", filedAt: DAY_1, renewedAt: null, seenAt: null });
      expect(await eventsOf(filed.id)).toEqual([FILED, RENEWED]);
      expect(await lastRunOf()).toMatchObject({
        outcome: "nothing",
        reason: null,
        filedCount: 0,
        renewedCount: 1,
        conversationId: "conversation-2",
      });
      // The later run was told which insight was open, by the id it then named.
      expect(installed.langy.starts[1]?.text).toContain(`- "${filed.id}": "Checkout cost doubled"`);
    });
  });

  describe("when a later run's finding carries the same key and names no insight", () => {
    /** @scenario "A finding with the key of an open insight renews it" */
    it("renews the insight that holds the key, whatever the finding's title", async () => {
      await runAt({ now: DAY_1, findings: [COST] });
      const filed = await insightTitled("Checkout cost doubled");

      await runAt({
        now: DAY_2,
        findings: [finding({ title: "Cost is double again", key: "Checkout Cost Doubled" })],
      });

      expect((await insightsOf()).map(({ id, renewedAt }) => ({ id, renewedAt }))).toEqual([
        { id: filed.id, renewedAt: DAY_2 },
      ]);
      expect(await lastRunOf()).toMatchObject({ filedCount: 0, renewedCount: 1 });
    });
  });
});

describe("given an open insight that keeps a query and one that keeps none", () => {
  /** @scenario "A renewed insight replays its own query over the later run's window" */
  it("replays the first's own query over the later run's window, and gives the second none", async () => {
    await runAt({
      now: DAY_1,
      findings: [{ ...COST, widgetId: "widget-cost", lwql: COST_QUERY }, ERRORS],
    });

    const { slot } = (await runAt({
      now: DAY_2,
      findings: [
        { ...COST, widgetId: "widget-errors", lwql: ERRORS_QUERY },
        { ...ERRORS, widgetId: "widget-cost", lwql: COST_QUERY },
      ],
    })) as { slot: number };

    const { window } = dailyRunWindows({ slot, timezone: "UTC" });
    expect(await insightTitled("Checkout cost doubled")).toMatchObject({
      lwql: COST_QUERY,
      replay: { ...window, granularitySeconds: 3_600, period: null, parameters: {} },
      board: { id: BOARD.id, widget: { id: "widget-cost", name: "Cost per day" } },
      renewedAt: DAY_2,
    });
    expect(await insightTitled("Errors rose on search")).toMatchObject({
      lwql: null,
      replay: null,
      board: { id: BOARD.id, widget: null },
      renewedAt: DAY_2,
    });
  });
});

describe("given an open insight the person has seen and kept, and one they have not seen", () => {
  /** @scenario "Renewal changes nothing the person did with the insight" */
  it("leaves the first seen and kept, the second unseen, and neither done", async () => {
    await runAt({ now: DAY_1, findings: [COST, ERRORS] });
    const acted = await insightTitled("Checkout cost doubled");
    const actedAt = DAY_1 + HOUR_MS;
    vi.setSystemTime(actedAt);
    const scope = { projectId: PROJECT, userId: MEMBER };
    await installed.app.markInsightsSeen({ ...scope, insightIds: [acted.id] });
    await installed.app.keepInsight({ ...scope, insightId: acted.id });

    await runAt({ now: DAY_2, findings: [COST, ERRORS] });

    expect(await insightTitled("Checkout cost doubled")).toMatchObject({
      renewedAt: DAY_2,
      seenAt: actedAt,
      keptAt: actedAt,
      archivedAt: null,
    });
    const untouched = await insightTitled("Errors rose on search");
    expect(untouched).toMatchObject({ renewedAt: DAY_2, seenAt: null, archivedAt: null });
    const inbox = deriveInsightInbox({ entries: await insightsOf(), now: DAY_2 });
    expect(inbox.unseen.map(({ id }) => id)).toEqual([untouched.id]);
  });
});

describe("given the person marked an insight for the board done", () => {
  /** @scenario "A finding that repeats an insight the person marked done does nothing" */
  it("neither renews it nor files a twin, for a finding with its key or with its id", async () => {
    await runAt({ now: DAY_1, findings: [COST, ERRORS] });
    const before = await insightsOf();
    const errors = await insightTitled("Errors rose on search");
    for (const { id } of before) {
      await installed.app.archiveInsight({ projectId: PROJECT, userId: MEMBER, insightId: id });
    }

    await runAt({ now: DAY_2, findings: [COST, finding({ renews: errors.id })] });

    const after = await insightsOf();
    expect(after.map(({ id, renewedAt }) => ({ id, renewedAt }))).toEqual(
      before.map(({ id }) => ({ id, renewedAt: null })),
    );
    for (const { id } of after) expect(await eventsOf(id)).toEqual([FILED, ARCHIVED]);
    expect(await lastRunOf()).toMatchObject({
      outcome: "nothing",
      reason: null,
      filedCount: 0,
      renewedCount: 0,
    });
  });

  /** @scenario "An insight marked done while Langy read is not found again" */
  it("does nothing for an insight the person marked done after the run briefed Langy", async () => {
    await runAt({ now: DAY_1, findings: [COST] });
    const filed = await insightTitled("Checkout cost doubled");
    installed.world.langy.settle = async (input) => {
      installed.world.langy.settle = null;
      await installed.app.archiveInsight({
        projectId: PROJECT,
        userId: MEMBER,
        insightId: filed.id,
      });
      return installed.langy.api.awaitTurnSettlement(input);
    };

    await runAt({ now: DAY_2, findings: [{ ...COST, renews: filed.id }] });

    expect(installed.langy.starts[1]?.text).toContain(`- "${filed.id}"`);
    expect(await eventsOf(filed.id)).toEqual([FILED, ARCHIVED]);
    expect(await insightsOf()).toHaveLength(1);
    expect(await lastRunOf()).toMatchObject({ outcome: "nothing", renewedCount: 0 });
  });
});

describe("given a finding that names an insight that is not the person's own for the board", () => {
  const ELSEWHERE: InsightRunBoard = { kind: "dashboard", id: "dashboard-2", name: "Latency" };

  /** @scenario "An id that is not the person's own insight for the board is ignored" */
  it("files it as new for the run's person, and renews nobody's insight", async () => {
    installed.world.boards.set(ELSEWHERE.id, {
      name: "Latency",
      widgets: [{ id: "widget-latency", name: "Latency p95" }],
    });
    await runAt({ now: DAY_1, userId: OTHER_MEMBER, findings: [COST] });
    await runAt({ now: DAY_1, board: ELSEWHERE, findings: [ERRORS] });
    const [theirs] = await insightsOf(OTHER_MEMBER);
    const elsewhere = await insightTitled("Errors rose on search");

    await runAt({
      now: DAY_2,
      findings: [
        // Another person's insight, by its id and by its key.
        { ...COST, title: "names another person's", renews: theirs?.id },
        // The person's own insight of another board, by its id and by its key.
        { ...ERRORS, title: "names another board's", renews: elsewhere.id },
        finding({ title: "names no insight", renews: "insight_nobody_has" }),
      ],
    });

    const mine = await insightsOf();
    expect(mine.filter((entry) => entry.board?.id === BOARD.id)).toEqual(
      ["names another person's", "names another board's", "names no insight"].map((title) =>
        expect.objectContaining({ title, ownerUserId: MEMBER, filedAt: DAY_2, renewedAt: null }),
      ),
    );
    expect(await lastRunOf()).toMatchObject({ outcome: "filed", filedCount: 3, renewedCount: 0 });
    expect(await eventsOf(elsewhere.id)).toEqual([FILED]);
    expect(await eventsOf(theirs?.id ?? "")).toEqual([FILED]);
    expect(await insightsOf(OTHER_MEMBER)).toEqual([theirs]);
  });
});

describe("given a run that renewed one insight and filed one", () => {
  /** @scenario "A run carried out twice renews once" */
  it("holds the same insights after the run is carried out again, each written once", async () => {
    await runAt({ now: DAY_1, findings: [COST] });
    const payload = await runAt({ now: DAY_2, findings: [COST, ERRORS] });
    const first = await insightsOf();
    const firstRun = await lastRunOf();

    vi.setSystemTime(DAY_2 + HOUR_MS);
    await installed.carryOut(payload);

    expect(await insightsOf()).toEqual(first);
    expect(first.map(({ title, renewedAt }) => ({ title, renewedAt }))).toEqual([
      { title: "Errors rose on search", renewedAt: null },
      { title: "Checkout cost doubled", renewedAt: DAY_2 },
    ]);
    expect(await eventsOf((await insightTitled("Checkout cost doubled")).id)).toEqual([
      FILED,
      RENEWED,
    ]);
    expect(await eventsOf((await insightTitled("Errors rose on search")).id)).toEqual([FILED]);
    const oneRun = [RUN_REQUESTED, RUN_STARTED, RUN_SETTLED];
    expect(await installed.runEventsOf()).toEqual([...oneRun, ...oneRun]);
    expect(firstRun).toMatchObject({ outcome: "filed", filedCount: 1, renewedCount: 1 });
    expect(await lastRunOf()).toEqual(firstRun);
    // The later run was briefed three times in all, twice with the same words: one turn.
    const briefs = installed.langy.starts.map(({ text }) => text);
    expect(briefs).toHaveLength(3);
    expect(briefs[2]).toBe(briefs[1]);
    expect(installed.langy.turns.size).toBe(2);
  });
});
