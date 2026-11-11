// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageFact,
  organizationUsageTraits,
} from "../nurturing-project-usage.rules.ts";
import type { NurturingTraceCounts } from "../nurturing-trace-day.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

const NO_TRACES: NurturingTraceCounts = {
  traceCount: 0,
  errorCount: 0,
  lastTraceAt: null,
  lastFailedTraceAt: null,
  activeDays: [],
};

const foldAll = (facts: readonly NurturingProjectUsageFact[]) =>
  facts.reduce(foldProjectUsage, emptyProjectUsage("project-1"));

describe("foldProjectUsage()", () => {
  /** @scenario "Prompts and evaluators count up when created and down when deleted" */
  it("counts prompts and evaluators up on created and down on deleted", () => {
    const state = foldAll([
      { kind: "prompt_created", promptId: "p1", occurredAt: 1 },
      { kind: "prompt_created", promptId: "p2", occurredAt: 2 },
      { kind: "prompt_deleted", promptId: "p3", occurredAt: 3 },
      { kind: "evaluator_created", evaluatorId: "e1", occurredAt: 4 },
      { kind: "evaluator_deleted", evaluatorId: "e1", occurredAt: 5 },
    ]);

    expect(state.promptIds).toEqual(["p1", "p2"]);
    expect(state.evaluatorIds).toEqual([]);
  });

  /** @scenario "Each simulation set counts once" */
  it("counts each simulation set once, however often its fact arrives", () => {
    const state = foldAll([
      { kind: "simulation_set_created", scenarioSetId: "set-1", occurredAt: 1 },
      { kind: "simulation_set_created", scenarioSetId: "set-1", occurredAt: 2 },
      { kind: "simulation_set_created", scenarioSetId: "set-2", occurredAt: 3 },
    ]);

    expect(state.simulationSetIds).toEqual(["set-1", "set-2"]);
  });

  /** @scenario "Prompt versions, scenario runs and evaluations mark their UTC day active" */
  it("marks the day of each prompt, prompt version, scenario run and evaluation once", () => {
    const state = foldAll([
      { kind: "prompt_created", promptId: "p1", occurredAt: NOW - 3 * DAY_MS },
      { kind: "prompt_version_saved", occurredAt: NOW - 2 * DAY_MS },
      { kind: "scenario_run", occurredAt: NOW - 2 * DAY_MS + 1000 },
      { kind: "evaluation_completed", occurredAt: NOW },
      { kind: "evaluator_created", evaluatorId: "e1", occurredAt: NOW - DAY_MS },
    ]);

    expect(state.activeDays).toEqual(["2026-11-17", "2026-11-18", "2026-11-20"]);
  });

  it("drops active days older than the window of the newest fact", () => {
    const state = foldAll([
      { kind: "prompt_version_saved", occurredAt: NOW - 40 * DAY_MS },
      { kind: "prompt_version_saved", occurredAt: NOW },
      { kind: "evaluation_completed", occurredAt: NOW + DAY_MS },
    ]);

    expect(state.activeDays).toEqual(["2026-11-20", "2026-11-21"]);
  });
});

describe("organizationUsageTraits()", () => {
  /** @scenario "The organization's traits sum its projects" */
  it("sums the organization's projects and its traces into its traits", () => {
    const first = foldAll([
      { kind: "prompt_created", promptId: "p1", occurredAt: NOW - DAY_MS },
      { kind: "scenario_created", scenarioCount: 2, occurredAt: NOW - DAY_MS },
    ]);
    const second = foldAll([
      { kind: "evaluator_created", evaluatorId: "e1", occurredAt: NOW - DAY_MS },
      { kind: "scenario_run", occurredAt: NOW - DAY_MS },
    ]);
    const createdAt = NOW - 10 * DAY_MS;

    expect(
      organizationUsageTraits({
        projects: [first, second],
        traces: {
          traceCount: 3,
          errorCount: 2,
          lastTraceAt: NOW - DAY_MS,
          lastFailedTraceAt: NOW - 2 * DAY_MS,
          activeDays: ["2026-11-18", "2026-11-19"],
        },
        now: NOW,
        organizationCreatedAt: createdAt,
      }),
    ).toEqual({
      prompt_count: 1,
      evaluator_count: 1,
      scenario_count: 2,
      simulation_set_count: 0,
      trace_count: 3,
      error_count: 2,
      last_trace_date: Math.floor((NOW - DAY_MS) / 1000),
      last_failed_trace_at: Math.floor((NOW - 2 * DAY_MS) / 1000),
      has_scenario_run: true,
      active_last_7_days: true,
      has_habit: false,
      back_since_day_0: true,
      window_end_date: Math.floor((createdAt + 14 * DAY_MS) / 1000),
      active_day_0: false,
      active_day_1: false,
      active_day_12: false,
      active_day_13: false,
    });
  });

  it("leaves out the failed-trace time and the window when they are unknown", () => {
    const traits = organizationUsageTraits({
      projects: [],
      traces: { ...NO_TRACES, traceCount: 1, lastTraceAt: NOW },
      now: NOW,
      organizationCreatedAt: null,
    });

    expect(traits).not.toHaveProperty("last_failed_trace_at");
    expect(traits).not.toHaveProperty("window_end_date");
    expect(traits).not.toHaveProperty("back_since_day_0");
    expect(traits).not.toHaveProperty("active_day_0");
  });

  it("leaves out the last trace's time when no trace is in the window", () => {
    const traits = organizationUsageTraits({
      projects: [],
      traces: NO_TRACES,
      now: NOW,
      organizationCreatedAt: null,
    });

    expect(traits).not.toHaveProperty("last_trace_date");
    expect(traits).toMatchObject({ trace_count: 0, has_habit: false });
  });

  it("is neither active this week nor back since day 0 when the last trace was on day 0", () => {
    const createdAt = NOW - 10 * DAY_MS;

    const traits = organizationUsageTraits({
      projects: [],
      traces: { ...NO_TRACES, traceCount: 1, lastTraceAt: createdAt + 1000 },
      now: NOW,
      organizationCreatedAt: createdAt,
    });

    expect(traits).toMatchObject({ active_last_7_days: false, back_since_day_0: false });
  });
});

describe("organizationUsageTraits() per signup day", () => {
  const traitsFor = (activeDays: readonly string[], organizationCreatedAt: number) =>
    organizationUsageTraits({
      projects: [],
      traces: { ...NO_TRACES, traceCount: activeDays.length, activeDays },
      now: NOW,
      organizationCreatedAt,
    });

  /** @scenario "The organization's activity on signup days 0, 1, 12 and 13 is a trait each" */
  it("marks each tracked day after signup with whether a trace arrived on it", () => {
    // Signed up 2026-11-07: day 0 is 11-07, day 1 is 11-08, day 12 is 11-19, day 13 is 11-20.
    const traits = traitsFor(["2026-11-07", "2026-11-19", "2026-11-20"], NOW - 13 * DAY_MS);

    expect(traits).toMatchObject({
      active_day_0: true,
      active_day_1: false,
      active_day_12: true,
      active_day_13: true,
    });
  });

  /** @scenario "A signup day that left the window is not sent" */
  it("leaves out a tracked day the window no longer covers", () => {
    // Signed up 40 days ago: days 0 and 1 are before the window, days 12 and 13 inside it.
    const traits = traitsFor(["2026-10-23"], NOW - 40 * DAY_MS);

    expect(traits).not.toHaveProperty("active_day_0");
    expect(traits).not.toHaveProperty("active_day_1");
    expect(traits).toMatchObject({ active_day_12: true, active_day_13: false });
  });
});

describe("organizationUsageTraits() has_habit", () => {
  const habitOf = (traceDays: readonly string[], otherDays: readonly string[] = []) =>
    organizationUsageTraits({
      projects: [{ ...emptyProjectUsage("project-1"), activeDays: [...otherDays] }],
      traces: { ...NO_TRACES, traceCount: traceDays.length, activeDays: traceDays },
      now: NOW,
      organizationCreatedAt: null,
    }).has_habit;

  /** @scenario "A habit is activity on 3 or more days at least 7 days apart, or in 3 ISO weeks" */
  it.each<[readonly string[], boolean]>([
    [["2026-11-10", "2026-11-13", "2026-11-17"], true],
    [["2026-11-01", "2026-11-05", "2026-11-12", "2026-11-19"], true],
    // Sunday of week 45, Monday of week 46, Monday of week 47.
    [["2026-11-08", "2026-11-09", "2026-11-16"], true],
    [["2026-11-10", "2026-11-13", "2026-11-16"], false],
    [["2026-11-01", "2026-11-19"], false],
    [[], false],
  ])("answers %j as %s", (traceDays, habit) => {
    expect(habitOf(traceDays)).toBe(habit);
  });

  /** @scenario "Prompt versions, scenario runs and evaluations count toward the habit" */
  it("counts the projects' other activity days with the trace days, each day once", () => {
    expect(habitOf(["2026-11-10"], ["2026-11-10", "2026-11-13", "2026-11-17"])).toBe(true);
    expect(habitOf(["2026-11-10"], ["2026-11-10", "2026-11-17"])).toBe(false);
  });

  it("ignores other activity days older than the window", () => {
    expect(habitOf(["2026-11-10", "2026-11-17"], ["2026-10-01"])).toBe(false);
  });
});
