// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The weekly folds: how a fact lands in a person's or a project's week, within its caps.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import { describe, expect, it } from "vitest";

import {
  emptyProjectWeek,
  emptyUserWeek,
  MAX_EVALUATORS,
  MAX_SERIES,
  type ProjectWeekState,
  type UserWeekState,
  userWeekTotals,
} from "../../rules/digest-week.rules.ts";
import {
  type ProjectActivity,
  projectActivitySchema,
  type UserActivity,
} from "../digest-activity.events.ts";
import { applyProjectActivity, applyUserActivity } from "../digest-week.projection.ts";

const seriesActivity = (seriesId: string): UserActivity => ({
  tenantId: "org-1",
  occurredAt: 0,
  organizationId: "org-1",
  isoWeek: "2026-W47",
  sourceKey: `source-${seriesId}`,
  userId: "user-1",
  sessionId: "session-1",
  repository: null,
  series: { seriesId, metric: "cost", type: null, value: 1 },
});

describe("applyUserActivity()", () => {
  describe("when the week already holds MAX_SERIES series", () => {
    const full: UserWeekState = {
      ...emptyUserWeek(),
      series: Object.fromEntries(
        Array.from({ length: MAX_SERIES }, (_, index) => [
          `series-${index}`,
          { metric: "cost", type: null, value: 1 },
        ]),
      ),
    };

    // `constructor` resolves on Object.prototype, so a plain index read would count it as held.
    it.each(["series-new", "constructor"])("drops a new series id %s", (seriesId) => {
      const { series } = applyUserActivity({ state: full, activity: seriesActivity(seriesId) });

      expect(Object.hasOwn(series, seriesId)).toBe(false);
      expect(Object.keys(series)).toHaveLength(MAX_SERIES);
    });
  });

  describe("when token series arrive, ten tokens each", () => {
    const tokens = (seriesId: string): UserActivity => ({
      ...seriesActivity(seriesId),
      series: { seriesId, metric: "token_usage", type: null, value: 10 },
    });
    const weekOf = (count: number) => {
      const activities = Array.from({ length: count }, (_, index) => tokens(`point-${index}`));
      return activities.reduce(
        (state, activity) => applyUserActivity({ state, activity }),
        emptyUserWeek(),
      );
    };

    /** @scenario "A person's week past its series cap reads its totals as floors" */
    it("totals the kept series and reads them as floors once more arrive than it keeps", () => {
      const week = weekOf(MAX_SERIES + 3);

      expect(Object.keys(week.series)).toHaveLength(MAX_SERIES);
      expect(week.seriesOverflow).toBe(3);
      expect(userWeekTotals(week)).toMatchObject({ tokens: MAX_SERIES * 10, atLeast: true });
    });

    /** @scenario "A person's week past its series cap reads its totals as floors" */
    it("reads its totals plainly while every series fits", () => {
      const week = weekOf(MAX_SERIES);

      expect(week.seriesOverflow).toBe(0);
      expect(userWeekTotals(week)).toMatchObject({ tokens: MAX_SERIES * 10, atLeast: false });
    });
  });

  describe("when a session's facts name its repository", () => {
    const metric: UserActivity = { ...seriesActivity("cost"), repository: null };
    const span: UserActivity = { ...metric, series: null, repository: "acme/api" };
    const fold = (activities: UserActivity[], state = emptyUserWeek()) =>
      activities.reduce((week, activity) => applyUserActivity({ state: week, activity }), state);

    it("counts the repository once when a metric fact without one lands first", () => {
      expect(fold([metric, span]).repositories).toEqual({ "acme/api": 1 });
    });

    it("counts the repository once when the span lands first", () => {
      expect(fold([span, metric]).repositories).toEqual({ "acme/api": 1 });
    });

    it("counts the repository once when two facts of the session name it", () => {
      expect(fold([span, span]).repositories).toEqual({ "acme/api": 1 });
    });
  });
});

const evaluationActivity = (evaluatorType: string): ProjectActivity => ({
  tenantId: "project-1",
  occurredAt: 0,
  organizationId: "org-1",
  isoWeek: "2026-W47",
  sourceKey: `source-${evaluatorType}`,
  projectId: "project-1",
  fact: { kind: "evaluation", evaluatorType, outcome: "passed" },
});

describe("applyProjectActivity()", () => {
  describe("when the week already holds MAX_EVALUATORS evaluators", () => {
    const outcomes = { runs: 1, passed: 1, failed: 0 };
    const full: ProjectWeekState = {
      ...emptyProjectWeek(),
      evaluators: Object.fromEntries(
        Array.from({ length: MAX_EVALUATORS }, (_, index) => [`evaluator-${index}`, outcomes]),
      ),
    };

    it("does not keep a new evaluator", () => {
      const week = applyProjectActivity({
        state: full,
        activity: evaluationActivity("evaluator-new"),
      });

      expect(Object.hasOwn(week.evaluators, "evaluator-new")).toBe(false);
      expect(Object.keys(week.evaluators)).toHaveLength(MAX_EVALUATORS);
    });

    it("still counts a run for an evaluator it already keeps", () => {
      const week = applyProjectActivity({
        state: full,
        activity: evaluationActivity("evaluator-0"),
      });

      expect(week.evaluators["evaluator-0"]).toEqual({ runs: 2, passed: 2, failed: 0 });
    });
  });
});

describe("a span fact stored before spans stopped being folded", () => {
  const stored = {
    tenantId: "org-1",
    occurredAt: 0,
    organizationId: "org-1",
    isoWeek: "2026-W47",
    sourceKey: "span-1",
    projectId: "project-1",
    fact: {
      kind: "span",
      root: true,
      error: false,
      tokens: 10,
      costUsd: 0.1,
      durationMs: 5,
      model: "gpt-5",
    },
  };

  /** @scenario "Trace spans are never folded" */
  it("still parses, and folds to nothing", () => {
    const activity: ProjectActivity = projectActivitySchema.parse(stored);
    const state = emptyProjectWeek();

    expect(applyProjectActivity({ state, activity })).toEqual(state);
  });
});
