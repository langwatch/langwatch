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

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

const foldAll = (facts: readonly NurturingProjectUsageFact[]) =>
  facts.reduce(foldProjectUsage, emptyProjectUsage("project-1"));

const trace = (
  traceId: string | null,
  occurredAt: number,
  { error = false, cost = null }: { error?: boolean; cost?: number | null } = {},
): NurturingProjectUsageFact => ({
  kind: "trace_received",
  traceId,
  containsErrorStatus: error,
  totalCost: cost,
  occurredAt,
});

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

  /** @scenario "A trace counts once however many times its received fact arrives" */
  it("keeps one entry per trace id, with the latest error status and cost", () => {
    const state = foldAll([
      trace("t1", NOW - 3000, { cost: 0.1 }),
      trace("t1", NOW - 2000, { cost: 0.2 }),
      trace("t1", NOW - 1000, { error: true, cost: 0.3 }),
    ]);

    expect(state.traces).toEqual({ t1: { at: NOW - 1000, error: true, cost: 0.3 } });
  });

  /** @scenario "Traces older than 30 days drop out of the counts" */
  it("drops traces older than 30 days before the newest fact", () => {
    const state = foldAll([trace("old", NOW - 31 * DAY_MS, { cost: 5 }), trace("new", NOW)]);

    expect(Object.keys(state.traces)).toEqual(["new"]);
  });

  /** @scenario "A trace_received from before it carried a trace id counts as an active day only" */
  it("counts a trace without an id as an active day only", () => {
    const state = foldAll([trace(null, NOW)]);

    expect(state.traces).toEqual({});
    expect(state.activeDays).toEqual(["2026-11-20"]);
  });
});

describe("organizationUsageTraits()", () => {
  /** @scenario "The organization's traits sum its projects" */
  it("sums the organization's projects into its traits", () => {
    const first = foldAll([
      { kind: "prompt_created", promptId: "p1", occurredAt: NOW - DAY_MS },
      { kind: "scenario_created", scenarioCount: 2, occurredAt: NOW - DAY_MS },
      trace("t1", NOW - 2 * DAY_MS, { error: true, cost: 0.25 }),
      trace("t2", NOW - DAY_MS, { cost: 0.5 }),
    ]);
    const second = foldAll([
      { kind: "evaluator_created", evaluatorId: "e1", occurredAt: NOW - DAY_MS },
      { kind: "scenario_run", occurredAt: NOW - DAY_MS },
      trace("t3", NOW - DAY_MS, { error: true, cost: null }),
    ]);
    const createdAt = NOW - 10 * DAY_MS;

    expect(
      organizationUsageTraits({
        projects: [first, second],
        now: NOW,
        organizationCreatedAt: createdAt,
      }),
    ).toEqual({
      prompt_count: 1,
      evaluator_count: 1,
      scenario_count: 2,
      trace_count: 3,
      error_count: 2,
      total_cost: 0.75,
      last_failed_trace_at: Math.floor((NOW - DAY_MS) / 1000),
      has_scenario_run: true,
      active_last_7_days: true,
      back_since_day_0: true,
      window_end_date: Math.floor((createdAt + 14 * DAY_MS) / 1000),
    });
  });

  it("leaves out the failed-trace time and the window when they are unknown", () => {
    const traits = organizationUsageTraits({
      projects: [foldAll([trace("t1", NOW)])],
      now: NOW,
      organizationCreatedAt: null,
    });

    expect(traits).not.toHaveProperty("last_failed_trace_at");
    expect(traits).not.toHaveProperty("window_end_date");
    expect(traits).not.toHaveProperty("back_since_day_0");
  });
});
