/**
 * Where a shorthand's filter lands in the statement it becomes: a condition in
 * the statement's own WHERE over `traces`, a subquery on the trace view over
 * every other target. What the filter compiles TO is the filter suite's
 * question (`./filter.unit.test.ts`); this one reads the statement around it.
 *
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import { describe, expect, it } from "vitest";

import { expandInstantEvalShorthand, type InstantEvalShorthandInput } from "..";

const NOW = new Date("2026-09-18T12:00:00.000Z");

const expand = (shorthand: Partial<InstantEvalShorthandInput> = {}) =>
  expandInstantEvalShorthand({
    shorthand: {
      target: "traces",
      questions: [{ kind: "boolean", instructions: "The customer is annoyed" }],
      ...shorthand,
    } as InstantEvalShorthandInput,
    database: "analytics",
    now: NOW,
  });

describe("expandInstantEvalShorthand, given a filter", () => {
  describe("when the target is traces", () => {
    /** @scenario "A supported filter field is compiled into the statement's WHERE" */
    it("writes the condition into the statement's own WHERE", () => {
      const { sql, parameters } = expand({ filter: "service:checkout" });

      expect(sql).toContain("Attributes['service.name'] = {service_0:String}");
      expect(parameters.service_0).toBe("checkout");
      expect(sql).not.toContain("TraceId IN (");
    });
  });

  describe("when the target reads another view", () => {
    /** @scenario "A filter on a target other than traces is applied through a trace subquery" */
    it("applies the filter through a time-bounded subquery on the trace view", () => {
      const { sql } = expand({ target: "threads", filter: "service:checkout" });

      expect(sql).toContain("TraceId IN (");
      expect(sql).toContain("FROM analytics.traces");
      expect(sql).toContain("OccurredAt >= {start_at:DateTime64(3)}");
    });

    /** @scenario "A filtered threads statement names the view's own trace column" */
    it("names the view's own trace column, not the aggregate the statement projects", () => {
      const { sql } = expand({ target: "threads", filter: "service:checkout" });

      // ClickHouse resolves a WHERE identifier against the SELECT aliases
      // first, and `threads` projects TraceId as argMax(...), which it refuses
      // in a WHERE. The subquery must therefore read the view's own column.
      expect(sql).toContain("m.TraceId IN (");
      expect(sql).not.toContain("\n  AND TraceId IN (");
    });

    /** @scenario "A filtered llm-spans statement reads its own plain trace column" */
    it("reads the plain trace column when the projection is not an aggregate", () => {
      const { sql } = expand({
        target: "llm_spans",
        filter: "service:checkout",
      });

      expect(sql).toContain("TraceId IN (");
      expect(sql).not.toContain("m.TraceId IN (");
    });
  });

  describe("when there is no filter", () => {
    /** @scenario "A shorthand with no filter writes no filter condition" */
    it("writes the window and nothing else", () => {
      const { sql, parameters } = expand();

      expect(sql).not.toContain("TraceId IN (");
      expect(Object.keys(parameters).sort()).toEqual(["end_at", "start_at"]);
    });
  });
});
