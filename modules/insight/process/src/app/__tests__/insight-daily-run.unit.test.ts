/**
 * @vitest-environment node
 * One daily run, end to end on a memory worker: the installed module, its real pipeline and
 * process, and the peers a run asks scripted by the test. The run's intent is carried out the
 * way the outbox carries it out, so a test can run it twice.
 * @see modules/insight/specs/insight-daily-run.feature
 */

import {
  deriveInsightInbox,
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_EVENT_TYPES,
  type InsightRunBoard,
} from "@langwatch/insight-contract";
import {
  LangyInsufficientScopeError,
  LangyTurnsRateLimitedError,
  LangyUnattendedTurnRefusedError,
} from "@langwatch/langy-contract";
import { nowInstant, Temporal } from "@langwatch/time";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  ORGANIZATION,
  OTHER_MEMBER,
  PROTECTIONS,
  refusal,
} from "./insight-daily-run.fixture.ts";
import { OTHER_PROJECT, PROJECT } from "./insight.fixture.ts";

const { RUN_REQUESTED, RUN_STARTED, RUN_SETTLED } = INSIGHT_DAILY_RUN_EVENT_TYPES;
const TWO_FINDINGS = answerWith([
  finding(),
  finding({ title: "Errors fell by half", tone: "good" }),
]);

let installed: InstalledDailyRuns;

beforeEach(async () => {
  installed = await installDailyRuns();
});

afterEach(async () => {
  await installed.stop();
});

type RunScope = { userId?: string; board?: InsightRunBoard; maxInsights?: 1 | 3 | 5 | 10 };

/** Asks for a run and answers the intent the schedule's process wrote for it. */
async function request({ userId = MEMBER, board = BOARD, maxInsights }: RunScope = {}) {
  const { requestId } = await installed.app.requestDailyRun({
    projectId: PROJECT,
    userId,
    board,
    ...(maxInsights ? { maxInsights } : {}),
  });
  // An operator's run is named by its request, once the schedule's process took the request.
  const intent = (await installed.intentsOf({ userId, board })).find(({ payload }) => {
    return (payload as { runId?: string }).runId === requestId;
  });
  if (!intent) throw new Error(`The schedule wrote no intent for request ${requestId}`);
  return { runId: requestId, payload: intent.payload as { slot: number; runId: string } };
}

/** Asks for a run and carries it out once, as a first delivery does. */
async function run(scope: RunScope = {}) {
  const requested = await request(scope);
  await installed.carryOut(requested.payload);
  return requested;
}

const runsOf = (userId = MEMBER) => installed.app.findDailyRuns({ projectId: PROJECT, userId });
const insightsOf = (userId = MEMBER) => installed.app.findInsights({ projectId: PROJECT, userId });

/** How the person's last run on the board ended. */
async function lastRunOf(scope: { userId?: string; board?: InsightRunBoard } = {}) {
  const id = installed.scheduleIdOf(scope);
  return (await runsOf(scope.userId)).find((candidate) => candidate.id === id)?.lastRun ?? null;
}

describe("given a member with analytics:view and a board with widgets", () => {
  describe("when a run is requested for them and Langy answers two findings", () => {
    beforeEach(() => {
      installed.world.langy.answer = TWO_FINDINGS;
    });

    /** @scenario "A run files what Langy found, for the person it ran for" */
    it("files two insights as a run, theirs and unseen, pointing at the board and the answer", async () => {
      await run();

      const entries = await insightsOf();
      const inbox = deriveInsightInbox({ entries, now: nowInstant().epochMilliseconds });

      expect(entries.map((entry) => entry.title).toSorted()).toEqual([
        "Checkout cost doubled",
        "Errors fell by half",
      ]);
      for (const entry of entries) {
        expect(entry).toMatchObject({
          filedVia: "run",
          ownerUserId: MEMBER,
          filedByUserId: null,
          seenAt: null,
          source: { conversationId: "conversation-1", messageId: "message-of-turn-1" },
          board: { id: BOARD.id, name: "Costs", widget: null },
        });
      }
      expect(inbox.unseen).toHaveLength(2);
      expect(await lastRunOf()).toMatchObject({
        outcome: "filed",
        reason: null,
        filedCount: 2,
        conversationId: "conversation-1",
      });
    });

    it("starts one unattended turn as that person, keyed by the run", async () => {
      const { runId } = await run();

      expect(installed.langy.starts).toEqual([
        {
          projectId: PROJECT,
          userId: MEMBER,
          idempotencyKey: `insight-daily-run:${installed.scheduleIdOf()}:${runId}`,
          text: expect.stringContaining('Dashboard: "Costs" (id "dashboard-1")'),
          title: expect.stringMatching(/^Daily insights - Costs - \d{4}-\d{2}-\d{2}$/),
        },
      ]);
      expect(installed.langy.waits).toEqual([
        expect.objectContaining({
          projectId: PROJECT,
          userId: MEMBER,
          conversationId: "conversation-1",
          turnId: "turn-1",
          shouldSettleOnUserWait: true,
        }),
      ]);
      expect(await installed.runEventsOf()).toEqual([RUN_REQUESTED, RUN_STARTED, RUN_SETTLED]);
    });

    /** @scenario "A run for one person changes nothing another person reads" */
    it("leaves another member's inbox and runs empty", async () => {
      await run();

      expect(await insightsOf(OTHER_MEMBER)).toEqual([]);
      expect(await runsOf(OTHER_MEMBER)).toEqual([]);
    });

    /** @scenario "A member removed after the run was requested gets no run" */
    it("skips the next run once the member was removed, without calling Langy again", async () => {
      await run();
      const filedBefore = (await insightsOf()).map((entry) => entry.id);

      installed.world.readers.delete(MEMBER);
      await run();

      expect(await lastRunOf()).toMatchObject({
        outcome: "skipped",
        reason: "no_access",
        filedCount: 0,
        conversationId: null,
      });
      expect(installed.langy.starts).toHaveLength(1);
      expect((await insightsOf()).map((entry) => entry.id)).toEqual(filedBefore);
    });

    it("skips a run already requested when the member is removed before it starts", async () => {
      const { payload } = await request();

      installed.world.readers.delete(MEMBER);
      await installed.carryOut(payload);

      expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "no_access" });
      expect(installed.langy.starts).toEqual([]);
      expect(await insightsOf()).toEqual([]);
    });
  });
});

describe("given a person who may not have a run", () => {
  beforeEach(() => {
    installed.world.langy.answer = TWO_FINDINGS;
  });

  /** @scenario "A member without analytics:view gets no run and Langy is never called" */
  it("skips a member without analytics:view, calls no Langy and files nothing", async () => {
    installed.world.readers.delete(MEMBER);

    await run();

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "no_access" });
    expect(installed.langy.starts).toEqual([]);
    expect(installed.boardReads).toEqual([]);
    expect(await insightsOf()).toEqual([]);
  });

  /** @scenario "A person who no longer exists gets no run" */
  it("skips a user id no user has", async () => {
    await run({ userId: "user-gone" });

    expect(await lastRunOf({ userId: "user-gone" })).toMatchObject({
      outcome: "skipped",
      reason: "user_missing",
    });
    expect(installed.langy.starts).toEqual([]);
  });

  /** @scenario "A deactivated person gets no run" */
  it("skips a member whose account was deactivated", async () => {
    installed.world.users.set(MEMBER, { deactivated: true });

    await run();

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "no_access" });
    expect(installed.langy.starts).toEqual([]);
  });

  /** @scenario "Langy refusing a deactivated person skips the run" */
  it("skips with no_access when Langy finds the person deactivated", async () => {
    installed.world.langy.startError = new LangyUnattendedTurnRefusedError(
      "langy_unattended_actor_deactivated",
    );

    await run();

    expect(await lastRunOf()).toMatchObject({
      outcome: "skipped",
      reason: "no_access",
      conversationId: null,
    });
    expect(await insightsOf()).toEqual([]);
  });

  /** @scenario "A member who lost access during the turn files nothing" */
  it("files nothing and records skipped when the member lost analytics:view while Langy read", async () => {
    installed.world.langy.settle = async (input) => {
      installed.world.langy.settle = null;
      installed.world.readers.delete(MEMBER);
      return installed.langy.api.awaitTurnSettlement(input);
    };

    await run();

    expect(installed.langy.starts).toHaveLength(1);
    expect(await insightsOf()).toEqual([]);
    expect(await lastRunOf()).toMatchObject({
      outcome: "skipped",
      reason: "no_access",
      filedCount: 0,
      conversationId: "conversation-1",
    });
  });

  it("files nothing when the person was deactivated while Langy read", async () => {
    installed.world.langy.settle = async (input) => {
      installed.world.langy.settle = null;
      installed.world.users.set(MEMBER, { deactivated: true });
      return installed.langy.api.awaitTurnSettlement(input);
    };

    await run();

    expect(await insightsOf()).toEqual([]);
    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "no_access" });
  });

  /** @scenario "Langy refusing the person skips the run" */
  it("skips with langy_off when Langy is not released to them, and no_access when it finds nothing to read with", async () => {
    installed.world.langy.startError = new LangyUnattendedTurnRefusedError(
      "langy_unattended_no_langy_access",
    );
    await run();
    installed.world.langy.startError = new LangyInsufficientScopeError("no permission");
    await run({ userId: OTHER_MEMBER });

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "langy_off" });
    expect(await lastRunOf({ userId: OTHER_MEMBER })).toMatchObject({
      outcome: "skipped",
      reason: "no_access",
    });
    expect(await insightsOf()).toEqual([]);
    expect(await insightsOf(OTHER_MEMBER)).toEqual([]);
  });

  it("skips with user_missing when Langy finds no such person", async () => {
    installed.world.langy.startError = new LangyUnattendedTurnRefusedError(
      "langy_unattended_actor_missing",
    );

    await run();

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "user_missing" });
  });
});

describe("given the release_insights flag is off for the project", () => {
  /** @scenario "A run cannot be requested while the flag is off" */
  it("refuses the request and records no run event", async () => {
    installed.world.flagOn = false;

    await expect(
      installed.app.requestDailyRun({ projectId: PROJECT, userId: MEMBER, board: BOARD }),
    ).rejects.toMatchObject({ code: "insights_not_enabled" });

    expect(await installed.runEventsOf()).toEqual([]);
    expect(await installed.intentsOf()).toEqual([]);
  });

  /** @scenario "A run that starts after the flag went off is skipped" */
  it("skips a run already requested, and calls no Langy", async () => {
    const { payload } = await request();

    installed.world.flagOn = false;
    await installed.carryOut(payload);
    installed.world.flagOn = true;

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "flag_off" });
    expect(installed.langy.starts).toEqual([]);
    expect(installed.boardReads).toEqual([]);
  });

  it("refuses to read a person's runs", async () => {
    installed.world.flagOn = false;

    await expect(runsOf()).rejects.toMatchObject({ code: "insights_not_enabled" });
  });
});

describe("given a project that is archived, an aggregate or gone", () => {
  /** @scenario "A project that takes no run is skipped" */
  it.each([
    ["archived", { kind: "application", archived: true }],
    ["an aggregate", { kind: "aggregate", archived: false }],
    ["gone", null],
  ])("skips a run in a project that is %s", async (_what, project) => {
    const { payload } = await request();

    installed.world.project = project;
    await installed.carryOut(payload);

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "project_unavailable" });
    expect(installed.langy.starts).toEqual([]);
  });
});

describe("given the board a run is asked for", () => {
  /** @scenario "A board that was deleted skips the run" */
  it("skips a board that was deleted after the request", async () => {
    const { payload } = await request();

    installed.world.boards.delete(BOARD.id);
    await installed.carryOut(payload);

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "board_deleted" });
    expect(installed.langy.starts).toEqual([]);
  });

  /** @scenario "A board that cannot be read in the project skips the run" */
  it.each(["dashboards_not_enabled", "custom_chart_playground_not_enabled"])(
    "skips a board the project refuses to read with %s",
    async (code) => {
      installed.world.boardReadError = refusal(code);

      await run();

      expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "board_unreadable" });
      expect(installed.langy.starts).toEqual([]);
    },
  );

  /** @scenario "A board with no widgets skips the run" */
  it("skips a board with no widgets", async () => {
    installed.world.boards.set(BOARD.id, { name: "Costs", widgets: [] });

    await run();

    expect(await lastRunOf()).toMatchObject({ outcome: "skipped", reason: "board_empty" });
    expect(installed.langy.starts).toEqual([]);
  });

  /** @scenario "A From LangWatch board is skipped with its own reason" */
  it("skips a From LangWatch board with its own reason, and names it on the run's row", async () => {
    const template: InsightRunBoard = { kind: "template", id: "llm-costs", name: "LLM costs" };

    await run({ board: template });

    expect(await runsOf()).toEqual([
      {
        id: installed.scheduleIdOf({ board: template }),
        board: template,
        lastRun: expect.objectContaining({ outcome: "skipped", reason: "template_board" }),
      },
    ]);
    expect(installed.langy.starts).toEqual([]);
    expect(installed.boardReads).toEqual([]);
  });

  /** @scenario "The board is read as the person the run is for" */
  it("reads the board and its widgets as the member the run is for, before the turn and after", async () => {
    await run();

    expect(installed.boardReads).toEqual([
      { read: "board", viewer: { userId: MEMBER } },
      { read: "widgets", viewer: { userId: MEMBER }, dashboardId: BOARD.id },
      { read: "board", viewer: { userId: MEMBER } },
      { read: "widgets", viewer: { userId: MEMBER }, dashboardId: BOARD.id },
    ]);
  });

  it("briefs Langy on this board's widgets alone, under the board's name as it is now", async () => {
    installed.world.boards.set(BOARD.id, {
      name: "Costs and errors",
      widgets: [{ id: "widget-cost", name: "Cost per day" }],
    });
    installed.world.boards.set("dashboard-2", {
      name: "Latency",
      widgets: [{ id: "widget-latency", name: "Latency p95" }],
    });

    await run();

    const [{ text } = { text: "" }] = installed.langy.starts;
    expect(text).toContain('Dashboard: "Costs and errors"');
    expect(text).toContain('- "widget-cost": "Cost per day"');
    expect(text).not.toContain("widget-latency");
    expect((await runsOf())[0]?.board).toEqual({ ...BOARD, name: "Costs and errors" });
  });
});

describe("given a board its author keeps as Only me", () => {
  const PRIVATE: InsightRunBoard = { kind: "dashboard", id: "dashboard-mine", name: "A board" };
  const stored = (scope: "PRIVATE" | "PROJECT") => ({
    name: "Acquisition plans",
    scope,
    createdById: MEMBER,
    widgets: [{ id: "widget-mine", name: "Runway" }],
  });

  beforeEach(() => {
    installed.world.langy.answer = TWO_FINDINGS;
    installed.world.boards.set(PRIVATE.id, stored("PRIVATE"));
  });

  /** @scenario "Another member's Only me board reads as a board that is not there" */
  it("skips another member's run exactly as it skips a board that never existed", async () => {
    const absent: InsightRunBoard = { kind: "dashboard", id: "dashboard-none", name: "A board" };

    await run({ userId: OTHER_MEMBER, board: PRIVATE });
    await run({ userId: OTHER_MEMBER, board: absent });

    const hidden = await lastRunOf({ userId: OTHER_MEMBER, board: PRIVATE });
    expect(hidden).toMatchObject({
      outcome: "skipped",
      reason: "board_deleted",
      filedCount: 0,
      conversationId: null,
    });
    expect({ ...hidden, at: 0 }).toEqual({
      ...(await lastRunOf({ userId: OTHER_MEMBER, board: absent })),
      at: 0,
    });
    // The row keeps the name the request gave, never the name the board holds.
    expect((await runsOf(OTHER_MEMBER)).map(({ board }) => board.name)).toEqual([
      "A board",
      "A board",
    ]);
    expect(installed.langy.starts).toEqual([]);
    expect(await insightsOf(OTHER_MEMBER)).toEqual([]);
  });

  /** @scenario "The author's run reads their own Only me board" */
  it("files the author's findings from their own Only me board", async () => {
    await run({ board: PRIVATE });

    expect(await lastRunOf({ board: PRIVATE })).toMatchObject({ outcome: "filed", filedCount: 2 });
    expect(installed.langy.starts[0]?.text).toContain('- "widget-mine": "Runway"');
    expect((await runsOf())[0]?.board).toEqual({ ...PRIVATE, name: "Acquisition plans" });
    expect(installed.boardReads.every(({ viewer }) => viewer !== undefined)).toBe(true);
  });

  /** @scenario "A board that turned Only me after the request skips another member's run" */
  it("skips another member's run once the author set the board to Only me", async () => {
    installed.world.boards.set(PRIVATE.id, stored("PROJECT"));
    const { payload } = await request({ userId: OTHER_MEMBER, board: PRIVATE });

    installed.world.boards.set(PRIVATE.id, stored("PRIVATE"));
    await installed.carryOut(payload);

    expect(await lastRunOf({ userId: OTHER_MEMBER, board: PRIVATE })).toMatchObject({
      outcome: "skipped",
      reason: "board_deleted",
    });
    expect(installed.langy.starts).toEqual([]);
  });

  it("files nothing for another member when the board turned Only me while Langy read it", async () => {
    installed.world.boards.set(PRIVATE.id, stored("PROJECT"));
    installed.world.langy.settle = async (input) => {
      installed.world.langy.settle = null;
      installed.world.boards.set(PRIVATE.id, stored("PRIVATE"));
      return installed.langy.api.awaitTurnSettlement(input);
    };

    await run({ userId: OTHER_MEMBER, board: PRIVATE });

    expect(await insightsOf(OTHER_MEMBER)).toEqual([]);
    expect(await lastRunOf({ userId: OTHER_MEMBER, board: PRIVATE })).toMatchObject({
      outcome: "skipped",
      reason: "board_deleted",
      filedCount: 0,
    });
  });
});

describe("given an Organization board another project owns", () => {
  const SHARED: InsightRunBoard = { kind: "dashboard", id: "dashboard-org", name: "Company" };
  const owned = (organizationId: string) => ({
    name: "Company costs",
    scope: "ORGANIZATION" as const,
    projectId: OTHER_PROJECT,
    organizationId,
    createdById: OTHER_MEMBER,
    widgets: [{ id: "widget-org", name: "Spend by team" }],
  });

  /** @scenario "An Organization board is read from another project of its organization" */
  it("reads the board's own widgets for a board of the run's organization", async () => {
    installed.world.boards.set(SHARED.id, owned(ORGANIZATION));

    await run({ board: SHARED });

    expect(installed.langy.starts[0]?.text).toContain('- "widget-org": "Spend by team"');
    expect(await lastRunOf({ board: SHARED })).toMatchObject({ outcome: "nothing" });
  });

  /** @scenario "An Organization board is read from another project of its organization" */
  it("skips a board of another organization as a board that is not there", async () => {
    installed.world.boards.set(SHARED.id, owned("organization-2"));

    await run({ board: SHARED });

    expect(await lastRunOf({ board: SHARED })).toMatchObject({
      outcome: "skipped",
      reason: "board_deleted",
    });
    expect(installed.langy.starts).toEqual([]);
  });

  it("skips another project's board that is not shared with the organization", async () => {
    installed.world.boards.set(SHARED.id, { ...owned(ORGANIZATION), scope: "PROJECT" });

    await run({ board: SHARED });

    expect(await lastRunOf({ board: SHARED })).toMatchObject({
      outcome: "skipped",
      reason: "board_deleted",
    });
  });
});

describe("given Langy's answer, which is untrusted", () => {
  /** @scenario "An answer with no findings files nothing" */
  it("files nothing for an empty list of findings, and records nothing", async () => {
    installed.world.langy.answer = answerWith([]);

    await run();

    expect(await insightsOf()).toEqual([]);
    expect(await lastRunOf()).toMatchObject({
      outcome: "nothing",
      reason: null,
      filedCount: 0,
      conversationId: "conversation-1",
    });
  });

  /** @scenario "An answer without the agreed block fails the run" */
  it("fails the run for prose with no findings block", async () => {
    installed.world.langy.answer = "Costs doubled on checkout. You should look at it.";

    await run();

    expect(await insightsOf()).toEqual([]);
    expect(await lastRunOf()).toMatchObject({ outcome: "failed", reason: "bad_output" });
  });

  /** @scenario "A bad answer files nothing" */
  it("files nothing when one finding of two is over the limits", async () => {
    installed.world.langy.answer = answerWith([finding(), finding({ title: "x".repeat(300) })]);

    await run();

    expect(await insightsOf()).toEqual([]);
    expect(await lastRunOf()).toMatchObject({
      outcome: "failed",
      reason: "bad_output",
      filedCount: 0,
    });
  });

  /** @scenario "An answer with a web address files nothing" */
  it("files nothing when a finding holds a link, and records finding_has_url", async () => {
    installed.world.langy.answer = answerWith([
      finding(),
      finding({ title: "Read this", body: "The full report is at https://evil.example/r?d=41" }),
    ]);

    await run();

    expect(await insightsOf()).toEqual([]);
    expect(await lastRunOf()).toMatchObject({
      outcome: "failed",
      reason: "finding_has_url",
      filedCount: 0,
    });
  });

  it("files nothing when a finding names an owner, and files for nobody else", async () => {
    installed.world.langy.answer = answerWith([finding({ ownerUserId: OTHER_MEMBER })]);

    await run();

    expect(await insightsOf()).toEqual([]);
    expect(await insightsOf(OTHER_MEMBER)).toEqual([]);
    expect(await lastRunOf()).toMatchObject({ outcome: "failed", reason: "bad_output" });
  });

  /** @scenario "More findings than the maximum are cut to the maximum" */
  it("files exactly the first 3 of 7 findings", async () => {
    const titles = ["one", "two", "three", "four", "five", "six", "seven"];
    installed.world.langy.answer = answerWith(titles.map((title) => finding({ title })));

    await run({ maxInsights: 3 });

    expect((await insightsOf()).map((entry) => entry.title).toSorted()).toEqual([
      "one",
      "three",
      "two",
    ]);
    expect(await lastRunOf()).toMatchObject({ outcome: "filed", filedCount: 3 });
  });

  /** @scenario "A widget that is not on the board is dropped from the finding" */
  it("points at a widget of the board under the board's name for it, and at the board alone otherwise", async () => {
    installed.world.langy.answer = answerWith([
      finding({ title: "on the board", widgetId: "widget-errors" }),
      finding({ title: "elsewhere", widgetId: "widget-of-another-board" }),
    ]);

    await run();

    const byTitle = new Map((await insightsOf()).map((entry) => [entry.title, entry.board]));
    expect(byTitle.get("on the board")).toEqual({
      id: BOARD.id,
      name: "Costs",
      widget: { id: "widget-errors", name: "Errors per day" },
    });
    expect(byTitle.get("elsewhere")).toEqual({ id: BOARD.id, name: "Costs", widget: null });
  });

  /** @scenario "A finding with a query is filed with the run's own window" */
  it("replays a finding's query over the window the run was given, and files no window without a query", async () => {
    installed.world.langy.answer = answerWith([
      finding({ title: "with a query", widgetId: "widget-cost", lwql: COST_QUERY }),
      finding({ title: "without a query" }),
    ]);

    const { payload } = await run();

    const { window } = dailyRunWindows({ slot: payload.slot, timezone: "UTC" });
    const byTitle = new Map((await insightsOf()).map((entry) => [entry.title, entry]));
    expect(byTitle.get("with a query")).toMatchObject({
      lwql: COST_QUERY,
      replay: { ...window, granularitySeconds: 3_600, period: null, parameters: {} },
    });
    expect(byTitle.get("without a query")).toMatchObject({ lwql: null, replay: null });
    expect(installed.langy.starts[0]?.text).toContain(
      `Window: ${window.start} to ${window.end} in epoch milliseconds`,
    );
  });
});

describe("given a finding's query, which a reader replays later", () => {
  const iso = (epochMs: number) => Temporal.Instant.fromEpochMilliseconds(epochMs).toString();

  /** @scenario "A query that does not validate is dropped and its finding is kept" */
  it("files a finding without the query the analytics module refuses, and keeps the one it admits", async () => {
    installed.world.lwql.refused.add(ERRORS_QUERY);
    installed.world.langy.answer = answerWith([
      finding({ title: "refused query", widgetId: "widget-errors", lwql: ERRORS_QUERY }),
      finding({ title: "admitted query", widgetId: "widget-cost", lwql: COST_QUERY }),
    ]);

    const { payload } = await run();

    const { window } = dailyRunWindows({ slot: payload.slot, timezone: "UTC" });
    const timeWindow = { start: iso(window.start), end: iso(window.end) };
    const byTitle = new Map((await insightsOf()).map((entry) => [entry.title, entry]));
    expect(byTitle.get("refused query")).toMatchObject({
      body: "Cost on checkout rose from 41 to 96 dollars against the day before.",
      lwql: null,
      replay: null,
    });
    expect(byTitle.get("admitted query")).toMatchObject({
      lwql: COST_QUERY,
      replay: { ...window, granularitySeconds: 3_600 },
    });
    expect(await lastRunOf()).toMatchObject({ outcome: "filed", filedCount: 2 });
    expect(installed.lwql.protectionAsks).toEqual([{ userId: MEMBER, projectId: PROJECT }]);
    expect(installed.lwql.validations).toEqual([
      { sql: ERRORS_QUERY, protections: PROTECTIONS, timeWindow },
      { sql: COST_QUERY, protections: PROTECTIONS, timeWindow },
    ]);
  });

  it("keeps no query when the analytics module will not say what the person may see", async () => {
    installed.world.lwql.protectionsError = refusal("project_not_found");
    installed.world.langy.answer = answerWith([
      finding({ widgetId: "widget-cost", lwql: COST_QUERY }),
    ]);

    await run();

    expect(await insightsOf()).toEqual([expect.objectContaining({ lwql: null, replay: null })]);
    expect(installed.lwql.validations).toEqual([]);
  });

  it("asks the analytics module nothing for an answer that carries no query", async () => {
    installed.world.langy.answer = TWO_FINDINGS;

    await run();

    expect(await insightsOf()).toHaveLength(2);
    expect(installed.lwql.protectionAsks).toEqual([]);
    expect(installed.lwql.validations).toEqual([]);
  });
});

describe("given a turn that does not end with an answer", () => {
  /** @scenario "A failed turn records a failed run" */
  it("records a failed turn as a failed run that names the conversation", async () => {
    installed.world.langy.settle = async () => ({
      kind: "settled",
      settlement: { succeeded: false, outcome: "failed", text: null, error: "model unavailable" },
    });

    await run();

    expect(await lastRunOf()).toMatchObject({
      outcome: "failed",
      reason: "turn_failed",
      conversationId: "conversation-1",
    });
    expect(await insightsOf()).toEqual([]);
  });

  it("records a turn somebody stopped as a failed run, and files nothing from its words", async () => {
    installed.world.langy.settle = async () => ({
      kind: "settled",
      settlement: {
        succeeded: true,
        outcome: "stopped",
        text: TWO_FINDINGS,
        messageId: "message-1",
        parts: [],
        error: null,
      },
    });

    await run();

    expect(await lastRunOf()).toMatchObject({ outcome: "failed", reason: "turn_stopped" });
    expect(await insightsOf()).toEqual([]);
  });

  /** @scenario "A turn that asks a question is stopped and recorded as failed" */
  it("stops a turn that asks the person a question, and records needs_input", async () => {
    installed.world.langy.settle = async () => ({
      kind: "awaiting_user",
      question: "Which period should I read?",
    });

    await run();

    expect(installed.langy.stops).toEqual([
      { conversationId: "conversation-1", turnId: "turn-1", userId: MEMBER },
    ]);
    expect(await lastRunOf()).toMatchObject({
      outcome: "failed",
      reason: "needs_input",
      conversationId: "conversation-1",
    });
  });

  /** @scenario "A run that cannot start is retried, then recorded on the last attempt" */
  it("throws a start failure for the retry with no outcome, then records it on the last attempt", async () => {
    installed.world.langy.startError = new Error("langy is down");
    const { payload } = await request();

    await expect(installed.carryOut(payload, { attempt: 1 })).rejects.toThrow("langy is down");
    await expect(installed.carryOut(payload, { attempt: 2 })).rejects.toThrow("langy is down");

    expect(await installed.runEventsOf()).toEqual([RUN_REQUESTED]);
    expect(await runsOf()).toEqual([]);

    await expect(installed.carryOut(payload, { attempt: 3 })).rejects.toThrow("langy is down");

    expect(await lastRunOf()).toMatchObject({
      outcome: "failed",
      reason: "error",
      filedCount: 0,
      conversationId: null,
    });
  });

  it("records rate_limited when the last attempt is still over Langy's window", async () => {
    installed.world.langy.startError = new LangyTurnsRateLimitedError({ retryAfterSeconds: 60 });
    const { payload } = await request();

    await expect(installed.carryOut(payload, { attempt: 3 })).rejects.toMatchObject({
      code: "langy_turns_rate_limited",
    });

    expect(await lastRunOf()).toMatchObject({ outcome: "failed", reason: "rate_limited" });
  });

  it("starts the run the retry succeeds on, and records that outcome alone", async () => {
    installed.world.langy.answer = TWO_FINDINGS;
    installed.world.langy.startError = new Error("langy is down");
    const { payload } = await request();
    await expect(installed.carryOut(payload, { attempt: 1 })).rejects.toThrow("langy is down");

    installed.world.langy.startError = null;
    await installed.carryOut(payload, { attempt: 2 });

    expect(await lastRunOf()).toMatchObject({ outcome: "filed", filedCount: 2 });
    expect(await installed.runEventsOf()).toEqual([RUN_REQUESTED, RUN_STARTED, RUN_SETTLED]);
  });
});

describe("given delivery at least once", () => {
  beforeEach(() => {
    installed.world.langy.answer = TWO_FINDINGS;
  });

  /** @scenario "A run carried out twice files once" */
  it("holds the same two insights after the run is carried out again, each filed once", async () => {
    const { payload } = await run();
    const first = (await insightsOf()).map((entry) => entry.id).toSorted();
    const firstRun = await lastRunOf();

    await installed.carryOut(payload);

    const again = await insightsOf();
    expect(again.map((entry) => entry.id).toSorted()).toEqual(first);
    expect(first).toHaveLength(2);
    for (const insightId of first) {
      expect(await installed.eventTypesOf({ projectId: PROJECT, insightId })).toEqual([
        INSIGHT_EVENT_TYPES.FILED,
      ]);
    }
    expect(await installed.runEventsOf()).toEqual([RUN_REQUESTED, RUN_STARTED, RUN_SETTLED]);
    expect(await lastRunOf()).toEqual(firstRun);
    // Langy was asked twice with the same key and the same words, so it answered one turn.
    expect(installed.langy.starts).toHaveLength(2);
    expect(new Set(installed.langy.starts.map(({ text }) => text)).size).toBe(1);
    expect(installed.langy.turns.size).toBe(1);
  });

  it("files each insight once when the first delivery died after Langy answered", async () => {
    const { payload } = await request();
    let deliveries = 0;
    installed.world.langy.settle = async (input) => {
      deliveries += 1;
      installed.world.langy.settle = null;
      const settled = await installed.langy.api.awaitTurnSettlement(input);
      // The first delivery loses its pod after Langy answered; the retry reads the same turn.
      if (deliveries === 1) throw new Error("pod lost");
      return settled;
    };

    await expect(installed.carryOut(payload, { attempt: 1 })).rejects.toThrow("pod lost");
    await installed.carryOut(payload, { attempt: 2 });

    expect(await insightsOf()).toHaveLength(2);
    expect(installed.langy.turns.size).toBe(1);
    expect(await lastRunOf()).toMatchObject({ outcome: "filed", filedCount: 2 });
  });

  it("fails the run when its board changed between two deliveries, and files nothing", async () => {
    const { payload } = await request();
    installed.world.langy.settle = async () => {
      throw new Error("pod lost");
    };
    await expect(installed.carryOut(payload, { attempt: 1 })).rejects.toThrow("pod lost");

    installed.world.langy.settle = null;
    installed.world.boards.set(BOARD.id, {
      name: "Costs",
      widgets: [{ id: "widget-new", name: "A widget added since" }],
    });
    await installed.carryOut(payload, { attempt: 2 });

    expect(await lastRunOf()).toMatchObject({ outcome: "failed", reason: "brief_changed" });
    expect(await insightsOf()).toEqual([]);
  });

  it("takes a second request once the first run settled, and files that run's own insights", async () => {
    await run();
    await run();

    expect(await insightsOf()).toHaveLength(4);
    expect(installed.langy.turns.size).toBe(2);
  });

  it("writes no second intent for a request made while a run is in flight", async () => {
    await request();
    await installed.app.requestDailyRun({ projectId: PROJECT, userId: MEMBER, board: BOARD });

    expect(await installed.intentsOf()).toHaveLength(1);
  });

  /** @scenario "A request is answered with its own id, which names no run" */
  it("answers a request made while a run is in flight with an id no run carries", async () => {
    const inFlight = await request();

    const answer = await installed.app.requestDailyRun({
      projectId: PROJECT,
      userId: MEMBER,
      board: BOARD,
    });

    const runIds = (await installed.intentsOf()).map(
      ({ payload }) => (payload as { runId: string }).runId,
    );
    expect(answer).toEqual({ requestId: expect.any(String) });
    expect(runIds).toEqual([inFlight.runId]);
    expect(runIds).not.toContain(answer.requestId);
  });
});

describe("given the run's row", () => {
  /** @scenario "A run before any other leaves a row for the person and the board" */
  it("reads no run until one settled, then one run for the board with its outcome and when it ran", async () => {
    const before = nowInstant().epochMilliseconds;
    const { payload } = await request();
    expect(await runsOf()).toEqual([]);

    await installed.carryOut(payload);

    expect(await runsOf()).toEqual([
      {
        id: installed.scheduleIdOf(),
        board: BOARD,
        lastRun: {
          at: expect.any(Number),
          outcome: "nothing",
          reason: null,
          filedCount: 0,
          conversationId: "conversation-1",
        },
      },
    ]);
    expect((await lastRunOf())?.at).toBeGreaterThanOrEqual(before);
  });

  it("keeps one row per board for the same person", async () => {
    installed.world.boards.set("dashboard-2", {
      name: "Latency",
      widgets: [{ id: "widget-latency", name: "Latency p95" }],
    });
    const latency: InsightRunBoard = { kind: "dashboard", id: "dashboard-2", name: "Latency" };

    await run();
    await run({ board: latency });

    expect((await runsOf()).map(({ board }) => board.name).toSorted()).toEqual([
      "Costs",
      "Latency",
    ]);
  });
});
