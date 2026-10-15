/**
 * A statement the caller's permissions refuse says what they lack, on the real catalogue and the
 * real validator, so a surface can tell "you may not see this" from "this query is broken".
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */
import {
  findLangWatchQLMissingGates,
  type LangWatchQLProtections,
  type LangWatchQLViolation,
} from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { catalogueWithout, EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const service = LangWatchQLService.create({ executor: null, database: "analytics" });

const SEES_EVERYTHING: LangWatchQLProtections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
  catalogue: EVERY_CATALOGUE_PERMISSION,
};
/** A Viewer or Lite member: everything but cost. */
const NO_COST: LangWatchQLProtections = {
  ...SEES_EVERYTHING,
  canSeeCosts: false,
  catalogue: catalogueWithout("cost:view"),
};

/** The violations the policy refuses a statement with; empty when it admits it. */
function refusalOf({
  sql,
  protections,
  isInstantEvalsEnabled = true,
}: {
  sql: string;
  protections: LangWatchQLProtections;
  isInstantEvalsEnabled?: boolean;
}): readonly LangWatchQLViolation[] {
  try {
    service.validate({ projectId: "project-1", protections, sql, isInstantEvalsEnabled });
    return [];
  } catch (error) {
    if (!HandledError.isHandled(error) || error.code !== "lwql_not_permitted") throw error;
    return (error.meta as { violations: readonly LangWatchQLViolation[] }).violations;
  }
}

describe("given a caller who may not see cost", () => {
  describe("when their statement reads a cost column", () => {
    /** @scenario "A refusal that is only about access names what the reader lacks" */
    it("refuses each reference naming cost:view, and classifies as an access refusal", () => {
      const violations = refusalOf({
        sql: "SELECT sum(TotalCost) AS cost, sum(UnpricedSpanCount) AS unpriced FROM analytics.traces",
        protections: NO_COST,
      });

      expect(violations.map((violation) => violation.code)).toEqual([
        "GATED_COLUMN",
        "GATED_COLUMN",
      ]);
      expect(violations.map((violation) => violation.missingGates)).toEqual([
        ["cost:view"],
        ["cost:view"],
      ]);
      expect(findLangWatchQLMissingGates(violations)).toEqual(["cost:view"]);
    });

    it("refuses one cost column among others as a whole, still as an access refusal", () => {
      const violations = refusalOf({
        sql: "SELECT TraceId, TotalDurationMs, TotalCost FROM analytics.traces",
        protections: NO_COST,
      });

      expect(findLangWatchQLMissingGates(violations)).toEqual(["cost:view"]);
    });
  });

  describe("when their statement reads a cost column and breaks another rule", () => {
    /** @scenario "A refusal about the query's shape is not one of access" */
    it("is not classified as an access refusal", () => {
      const violations = refusalOf({
        sql: "SELECT sum(TotalCost) AS cost FROM analytics.traces SETTINGS max_threads = 1",
        protections: NO_COST,
      });

      expect(violations.map((violation) => violation.code)).toContain("GATED_COLUMN");
      expect(findLangWatchQLMissingGates(violations)).toEqual([]);
    });
  });

  describe("when their statement reads no cost", () => {
    it("is admitted", () => {
      expect(
        refusalOf({ sql: "SELECT count() AS traces FROM analytics.traces", protections: NO_COST }),
      ).toEqual([]);
    });
  });
});

describe("given a caller who sees everything", () => {
  it("admits the cost statement, so the refusal follows the caller and not the query", () => {
    expect(
      refusalOf({
        sql: "SELECT sum(TotalCost) AS cost FROM analytics.traces",
        protections: SEES_EVERYTHING,
      }),
    ).toEqual([]);
  });
});

describe("given a caller who may not see what the agent answered", () => {
  const NO_OUTPUT: LangWatchQLProtections = { ...SEES_EVERYTHING, canSeeCapturedOutput: false };
  const TRANSCRIPT =
    "SELECT conversation(ConversationId) AS transcript FROM analytics.trace_metrics";

  describe("when their statement calls a function that reads it", () => {
    /** @scenario "A function the caller lacks the permission for names that permission" */
    it("names the content the caller lacks", () => {
      const violations = refusalOf({ sql: TRANSCRIPT, protections: NO_OUTPUT });

      expect(violations.map((violation) => violation.code)).toEqual(["APP_FUNCTION_GATED"]);
      expect(findLangWatchQLMissingGates(violations)).toEqual(["output"]);
    });
  });

  describe("when an eval function is refused because Instant Evals is off", () => {
    /** @scenario "A function the caller lacks the permission for names that permission" */
    it("carries no gate, since no permission would lift it", () => {
      const violations = refusalOf({
        sql: "SELECT eval(CapturedInput, 'is the user annoyed') AS annoyed FROM analytics.traces",
        protections: SEES_EVERYTHING,
        isInstantEvalsEnabled: false,
      });

      expect(violations.map((violation) => violation.code)).toEqual(["APP_FUNCTION_GATED"]);
      expect(findLangWatchQLMissingGates(violations)).toEqual([]);
    });
  });
});
