/**
 * @vitest-environment node
 * The board check of a daily run, end to end on a memory worker: the installed module, its
 * real pipeline and process, the analytics module's answers scripted per statement.
 * @see modules/insight/specs/insight-board-health.feature
 */

import { INSIGHT_EVENT_TYPES } from "@langwatch/insight-contract";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { Temporal } from "@langwatch/time";
import { LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRIEF_DATA_CLOSES } from "../../rules/insight-daily-run-brief.rules.ts";
import { dailyRunWindows } from "../../rules/insight-daily-run.rules.ts";
import { INSIGHT_BOARD_HEALTH_CHECK_METRIC_NAME as CHECKS } from "../../services/insight-daily-run-metrics.service.ts";
import {
  answerWith,
  BOARD,
  COST_QUERY,
  ERRORS_QUERY,
  finding,
  installDailyRuns,
  type InstalledDailyRuns,
  MEMBER,
  refusal,
  RUN_CALLER,
} from "./insight-daily-run.fixture.ts";
import { PROJECT } from "./insight.fixture.ts";

const { FILED, RENEWED } = INSIGHT_EVENT_TYPES;
const HOUR_MS = 3_600_000;
const DAY_1 = Date.UTC(2026, 9, 10, 9, 37);
const DAY_2 = DAY_1 + 24 * HOUR_MS;
const NO_DATA_KEY = "board-health:widget-errors:no_data";

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

/** Carries out one run at `now`, and hands back the payload the outbox carried. */
async function runAt({ now = DAY_1 }: { now?: number } = {}) {
  vi.setSystemTime(now);
  const { requestId } = await installed.app.requestDailyRun({
    projectId: PROJECT,
    userId: MEMBER,
    board: BOARD,
  });
  const intent = (await installed.intentsOf()).find(({ payload }) => {
    return (payload as { runId?: string }).runId === requestId;
  });
  if (!intent) throw new Error(`The schedule wrote no intent for request ${requestId}`);
  await installed.carryOut(intent.payload);
  return intent.payload as { slot: number; runId: string };
}

const insightsOf = () => installed.app.findInsights({ projectId: PROJECT, userId: MEMBER });
const eventsOf = (insightId: string) => installed.eventTypesOf({ projectId: PROJECT, insightId });

async function lastRunOf() {
  const id = installed.scheduleIdOf();
  const runs = await installed.app.findDailyRuns({ projectId: PROJECT, userId: MEMBER });
  return runs.find((candidate) => candidate.id === id)?.lastRun ?? null;
}

/** Scripts the statement of the board's errors widget. */
function errorsWidget(script: Parameters<InstalledDailyRuns["world"]["statements"]["set"]>[1]) {
  installed.world.statements.set(ERRORS_QUERY, script);
}

/** A board of `count` widgets, each with its own query, all answering as `script` says. */
function boardOf(count: number, script: Parameters<typeof errorsWidget>[0]) {
  const widgets = Array.from({ length: count }, (_, at) => ({
    id: `widget-${at + 1}`,
    name: `Widget ${at + 1}`,
    queries: [`from traces | count(w${at + 1})`],
  }));
  installed.world.boards.set(BOARD.id, { name: "Costs", widgets });
  for (const { queries } of widgets) installed.world.statements.set(queries[0] ?? "", script);
}

describe("given a project that took no trace since the run's window began", () => {
  beforeEach(() => {
    installed.world.hasNewTraces = false;
  });

  describe("when the board's widget returns no rows", () => {
    beforeEach(() => {
      installed.world.boards.set(BOARD.id, {
        name: "Costs",
        widgets: [{ id: "widget-errors", name: "Errors per day", queries: [ERRORS_QUERY] }],
      });
      errorsWidget({ rows: [] });
    });

    /** @scenario "A widget that shows no data files a card on a day without new traces" */
    it("files one card for the widget and records filed with no_new_traces, asking Langy nothing", async () => {
      await runAt();

      expect(await insightsOf()).toEqual([
        expect.objectContaining({
          title: '"Errors per day" shows no data',
          tone: "watch",
          topic: "health",
          validDays: 3,
          filedVia: "run",
          ownerUserId: MEMBER,
          filedByUserId: null,
          source: null,
          lwql: null,
          findingKey: NO_DATA_KEY,
          board: {
            id: BOARD.id,
            name: "Costs",
            widget: { id: "widget-errors", name: "Errors per day" },
          },
        }),
      ]);
      expect(await lastRunOf()).toMatchObject({
        outcome: "filed",
        reason: "no_new_traces",
        filedCount: 1,
        renewedCount: 0,
      });
      expect(installed.langy.starts).toEqual([]);
    });
  });

  describe("when every widget returns data", () => {
    /** @scenario "A healthy board on a day without new traces files nothing" */
    it("records nothing with no_new_traces and files nothing", async () => {
      await runAt();

      expect(await insightsOf()).toEqual([]);
      expect(await lastRunOf()).toMatchObject({
        outcome: "nothing",
        reason: "no_new_traces",
        filedCount: 0,
      });
      expect(installed.lwql.backgroundExecutions.map(({ sql }) => sql)).toEqual([
        COST_QUERY,
        ERRORS_QUERY,
      ]);
    });
  });
});

describe("given a project that took a trace and a widget that returns no rows", () => {
  beforeEach(() => {
    errorsWidget({ rows: [] });
  });

  /** @scenario "The check's cards and Langy's findings add up in one outcome" */
  it("records filed with the check's card and Langy's finding counted together", async () => {
    installed.world.langy.answer = answerWith([finding()]);

    await runAt();

    expect(await lastRunOf()).toMatchObject({ outcome: "filed", reason: null, filedCount: 2 });
  });

  /** @scenario "A run whose Langy turn fails keeps the count of the cards the check filed" */
  it("records the failed run with the card it filed", async () => {
    installed.world.langy.settle = async () => ({
      kind: "settled",
      settlement: { succeeded: false, outcome: "failed", text: null, error: "model unavailable" },
    });

    await runAt();

    expect(await lastRunOf()).toMatchObject({
      outcome: "failed",
      reason: "turn_failed",
      filedCount: 1,
    });
  });

  /** @scenario "The brief names the reported widgets and never lists their cards" */
  it("names the widget as already reported and lists none of its cards as open", async () => {
    await runAt();
    const [card] = await insightsOf();

    await runAt({ now: DAY_2 });

    const brief = installed.langy.starts.at(-1)?.text ?? "";
    const reported = brief.slice(brief.indexOf("Already reported as broken:"));
    expect(reported.slice(0, reported.indexOf(BRIEF_DATA_CLOSES))).toContain(
      '- "widget-errors": "Errors per day"',
    );
    expect(brief).toContain("Do not report them.");
    expect(brief).toContain("The person has no open insights for this dashboard.");
    expect(brief).not.toContain(card?.id ?? "no card");
  });

  /** @scenario "A Langy finding that names a health card is filed as new" */
  it("files Langy's finding as new and leaves the card to the check", async () => {
    await runAt();
    const [card] = await insightsOf();
    installed.world.langy.answer = answerWith([finding({ renews: card?.id })]);

    await runAt({ now: DAY_2 });

    const titles = (await insightsOf())
      .map(({ title }) => title)
      .toSorted((a, b) => a.localeCompare(b));
    expect(titles).toEqual(['"Errors per day" shows no data', "Checkout cost doubled"]);
    // Renewed once, by the check of the second day, and never by Langy's finding.
    expect(await eventsOf(card?.id ?? "")).toEqual([FILED, RENEWED]);
    expect(await lastRunOf()).toMatchObject({ filedCount: 1, renewedCount: 1 });
  });
});

describe("given a board's statements as the board runs them", () => {
  /** @scenario "A statement runs as the person over the board's default period" */
  it("runs each one as the person over the 30 days before the run's window ends, with its defaults", async () => {
    installed.world.boards.set(BOARD.id, {
      name: "Costs",
      widgets: [
        {
          id: "widget-cost",
          name: "Cost per model",
          queries: [COST_QUERY],
          parameters: [{ name: "model", type: "string", default: "gpt-5" }],
        },
      ],
    });

    const { slot } = await runAt();

    const { window } = dailyRunWindows({ slot, timezone: "UTC" });
    const end = Temporal.Instant.fromEpochMilliseconds(window.end);
    expect(installed.lwql.backgroundExecutions).toEqual([
      {
        ...RUN_CALLER,
        sql: COST_QUERY,
        parameters: { model: "gpt-5" },
        timeWindow: { start: end.subtract({ hours: 720 }).toString(), end: end.toString() },
        granularitySeconds: 86_400,
        onBudgetOverflow: "coarsen",
        excludeOrigins: [LANGY_TRACE_ORIGIN],
      },
    ]);
  });

  it("leaves out no origin in a person's own project", async () => {
    installed.world.project = { kind: "application", archived: false, personal: true };

    await runAt();

    expect(installed.lwql.backgroundExecutions.map(({ excludeOrigins }) => excludeOrigins)).toEqual(
      [[], []],
    );
  });

  /** @scenario "Every statement runs as a background caller" */
  it("asks for a background caller's share of the project's query window for every statement", async () => {
    await runAt();

    expect(installed.lwql.backgroundExecutions.map(({ sql }) => sql)).toEqual([
      COST_QUERY,
      ERRORS_QUERY,
    ]);
  });

  /** @scenario "A statement that calls an eval function is never run" */
  it("validates a statement that calls an eval function with the gate open, and never runs it", async () => {
    errorsWidget({ judged: true, rows: [] });
    const metrics = createRecordingMeterProvider();
    metrics.install();

    await runAt();
    const results = metrics.recorded.filter(({ instrument }) => instrument === CHECKS);
    metrics.uninstall();

    expect(installed.lwql.checkValidations.map(({ sql }) => sql)).toEqual([
      COST_QUERY,
      ERRORS_QUERY,
    ]);
    expect(installed.lwql.backgroundExecutions.map(({ sql }) => sql)).toEqual([COST_QUERY]);
    expect(await insightsOf()).toEqual([]);
    expect(results.map(({ attributes }) => attributes)).toEqual([
      { result: "healthy" },
      { result: "unchecked" },
    ]);
  });

  /** @scenario "A statement with a parameter that has no default is never run" */
  it("neither validates nor runs a statement whose parameter has no default", async () => {
    installed.world.boards.set(BOARD.id, {
      name: "Costs",
      widgets: [
        {
          id: "widget-cost",
          name: "Cost per model",
          queries: [COST_QUERY],
          parameters: [{ name: "model", type: "string" }],
        },
      ],
    });

    await runAt();

    expect(installed.lwql.checkValidations).toEqual([]);
    expect(installed.lwql.backgroundExecutions).toEqual([]);
    expect(await insightsOf()).toEqual([]);
  });

  /** @scenario "A widget with no stored query is not checked" */
  it("runs nothing for a widget that stores no query", async () => {
    installed.world.boards.set(BOARD.id, {
      name: "Costs",
      widgets: [{ id: "widget-empty", name: "Notes" }],
    });

    await runAt();

    expect(installed.lwql.backgroundExecutions).toEqual([]);
    expect(await insightsOf()).toEqual([]);
  });
});

describe("given a widget whose stored query is refused for the person", () => {
  /** @scenario "A refusal the person can fix files an error card" */
  it("files one error card that names the code and holds no web address", async () => {
    const unknown = refusal("lwql_unknown_identifier");
    errorsWidget({ error: unknown });

    await runAt();

    const cards = await insightsOf();
    expect(cards).toEqual([
      expect.objectContaining({
        title: '"Errors per day" fails to load',
        tone: "bad",
        findingKey: "board-health:widget-errors:error",
      }),
    ]);
    expect(cards[0]?.body).toContain("`lwql_unknown_identifier`");
    expect(cards[0]?.body).not.toMatch(/https?:|www\./);
  });
});

describe("given failures the person cannot fix", () => {
  /** @scenario "A platform failure leaves the run to carry on" */
  it("files nothing, counts each widget platform, and still asks for new traces", async () => {
    const outage = Object.assign(refusal("clickhouse_unavailable"), { httpStatus: 503 });
    errorsWidget({ error: outage });
    installed.world.statements.set(COST_QUERY, { error: new Error("socket hang up") });
    const metrics = createRecordingMeterProvider();
    metrics.install();

    await runAt();
    const results = metrics.recorded.filter(({ instrument }) => instrument === CHECKS);
    metrics.uninstall();

    expect(await insightsOf()).toEqual([]);
    expect(results.map(({ attributes }) => attributes)).toEqual([
      { result: "platform" },
      { result: "platform" },
    ]);
    expect(installed.lwql.traceAsks).toHaveLength(1);
    expect(installed.langy.starts).toHaveLength(1);
  });

  /** @scenario "When most statements fail with the same code, the whole check is the platform's" */
  it("files nothing when 4 of 4 widgets fail with one code, and files 2 of 6", async () => {
    boardOf(4, { error: refusal("lwql_unknown_identifier") });

    await runAt();
    expect(await insightsOf()).toEqual([]);

    boardOf(6, {});
    for (const at of [1, 2]) {
      installed.world.statements.set(`from traces | count(w${at})`, {
        error: refusal("lwql_unknown_identifier"),
      });
    }
    await runAt({ now: DAY_2 });

    const keys = (await insightsOf()).map(({ findingKey }) => findingKey ?? "");
    expect(keys.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "board-health:widget-1:error",
      "board-health:widget-2:error",
    ]);
  });
});

describe("given a project the Workbench rollout does not admit", () => {
  /** @scenario "With the Workbench off for the project, no statement runs" */
  it("validates and runs nothing, files nothing, and counts the check off once", async () => {
    installed.world.workbenchOn = false;
    errorsWidget({ rows: [] });
    const metrics = createRecordingMeterProvider();
    metrics.install();

    await runAt();
    const results = metrics.recorded.filter(({ instrument }) => instrument === CHECKS);
    metrics.uninstall();

    expect(installed.lwql.checkValidations).toEqual([]);
    expect(installed.lwql.backgroundExecutions).toEqual([]);
    expect(await insightsOf()).toEqual([]);
    expect(results.map(({ attributes }) => attributes)).toEqual([{ result: "off" }]);
  });
});

describe("given a query window that stays full for longer than the check has left", () => {
  /** @scenario "A full query window whose wait outlasts the budget ends the check" */
  it("runs no further statement and files nothing for the widgets left", async () => {
    const full = Object.assign(refusal("lwql_rate_limited"), {
      httpStatus: 429,
      meta: { retryAfterSeconds: 600 },
    });
    installed.world.statements.set(COST_QUERY, { error: full });
    errorsWidget({ rows: [] });

    await runAt();

    expect(installed.lwql.backgroundExecutions.map(({ sql }) => sql)).toEqual([COST_QUERY]);
    expect(await insightsOf()).toEqual([]);
  });
});

describe("given a card the check filed yesterday", () => {
  beforeEach(async () => {
    errorsWidget({ rows: [] });
    await runAt();
  });

  /** @scenario "A widget still broken the next day renews its card" */
  it("renews that card when the widget is still broken, and files nothing", async () => {
    const [card] = await insightsOf();

    await runAt({ now: DAY_2 });

    expect((await insightsOf()).map(({ id }) => id)).toEqual([card?.id]);
    expect(await eventsOf(card?.id ?? "")).toEqual([FILED, RENEWED]);
    expect(await lastRunOf()).toMatchObject({ filedCount: 0, renewedCount: 1 });
  });

  /** @scenario "A card marked done stays done while the widget stays broken" */
  it("renews a card marked done and leaves it done", async () => {
    const [card] = await insightsOf();
    await installed.app.archiveInsight({
      projectId: PROJECT,
      userId: MEMBER,
      insightId: card?.id ?? "",
    });

    await runAt({ now: DAY_2 });

    expect(await insightsOf()).toEqual([
      expect.objectContaining({ id: card?.id, archivedAt: expect.any(Number), renewedAt: DAY_2 }),
    ]);
  });

  /** @scenario "A retried run files each card once" */
  it("files the card once, under the same id, when the run is carried out again", async () => {
    const payload = await runAt({ now: DAY_2 + 4 * 24 * HOUR_MS });
    const first = await insightsOf();
    const firstRun = await lastRunOf();

    await installed.carryOut(payload);

    expect(await insightsOf()).toEqual(first);
    expect(first).toHaveLength(2);
    expect(firstRun).toMatchObject({ filedCount: 1 });
    expect(await lastRunOf()).toEqual(firstRun);
    expect(await eventsOf(first[0]?.id ?? "")).toEqual([FILED]);
  });
});
