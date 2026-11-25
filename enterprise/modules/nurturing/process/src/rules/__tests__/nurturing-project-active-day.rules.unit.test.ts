// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The project's active day, derived from a trace or a succeeded run.
 * @see specs/analytics/posthog-product-milestones.feature
 */
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  projectActiveDaySignal,
  scenarioRunActiveDaySignal,
} from "../nurturing-owner-signals.rules.ts";

const DAY = 24 * 60 * 60 * 1000;
const SIGNAL_AT = 1_791_280_800_000;
const base = {
  source: "trace" as const,
  tenantId: "project-1",
  projectId: "project-1",
  userId: "admin-1",
  occurredAt: SIGNAL_AT,
};

describe("projectActiveDaySignal()", () => {
  describe("when the organization was created three and a half days before", () => {
    /** @scenario "the days since signup count whole days from the organization's creation" */
    it("counts 3 whole days, and 0 for a signal dated before the creation", () => {
      const created = projectActiveDaySignal({
        ...base,
        organizationCreatedAt: SIGNAL_AT - 3.5 * DAY,
      });
      const early = projectActiveDaySignal({ ...base, organizationCreatedAt: SIGNAL_AT + DAY });

      expect(created).toMatchObject({ kind: "project_active_day", daysSinceSignup: 3 });
      expect(early).toMatchObject({ daysSinceSignup: 0 });
    });
  });

  describe("when the project signals on two instants of one UTC day and one of the next", () => {
    /** @scenario "the first signal of the day tracks the project's active day" */
    it("keys the first two alike and the third apart, with the experiment variant", () => {
      const morning = projectActiveDaySignal({ ...base, onboardingVariant: "guided" });
      const evening = projectActiveDaySignal({
        ...base,
        occurredAt: SIGNAL_AT + 13 * 60 * 60 * 1000,
      });
      const nextDay = projectActiveDaySignal({
        ...base,
        occurredAt: SIGNAL_AT + 15 * 60 * 60 * 1000,
      });

      expect(morning).toMatchObject({
        sourceEventId: "project-1:2026-10-06",
        onboardingVariant: "guided",
        source: "trace",
      });
      expect(evening.sourceEventId).toBe(morning.sourceEventId);
      expect(nextDay.sourceEventId).toBe("project-1:2026-10-07");
    });
  });

  describe("when the owner did not say when the organization was created", () => {
    it("carries no days since signup", () => {
      expect(projectActiveDaySignal(base)).toMatchObject({ daysSinceSignup: null });
    });
  });
});

describe("scenarioRunActiveDaySignal()", () => {
  const run = (data: Partial<SimulationRunFinishedEventData> = {}) =>
    scenarioRunActiveDaySignal({
      aggregateId: "run-1",
      tenantId: "project-1",
      data: {
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        target: { type: "connected", referenceId: "agent-1" },
        results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
        status: "SUCCESS",
        organizationAdmin: { userId: "admin-1", onboardingVariant: "classic" },
        occurredAt: SIGNAL_AT,
        ...data,
      },
    });

  describe("when a run against a connected agent finishes with a verdict", () => {
    /** @scenario "a succeeded scenario run against a connected agent is a signal of the day" */
    it("raises the active day with the source scenario_run, against the run's admin", () => {
      expect(run()).toEqual([
        expect.objectContaining({
          kind: "project_active_day",
          source: "scenario_run",
          userId: "admin-1",
          projectId: "project-1",
          onboardingVariant: "classic",
          sourceEventId: "project-1:2026-10-06",
        }),
      ]);
    });
  });

  describe("when the run ended ungraded, against another target, or names no admin", () => {
    it("raises nothing", () => {
      expect(run({ status: "ERROR", results: undefined })).toEqual([]);
      expect(run({ target: { type: "prompt", referenceId: "p-1" } })).toEqual([]);
      expect(run({ organizationAdmin: undefined })).toEqual([]);
    });
  });
});
