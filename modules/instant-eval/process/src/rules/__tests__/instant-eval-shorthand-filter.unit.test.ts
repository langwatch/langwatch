/**
 * Where a shorthand's filter lands in the statement it becomes, and what a
 * resolved selection replaces it with.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import {
  INSTANT_EVAL_SELECTION_PARAMETER,
  type InstantEvalShorthandInput,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  type CompiledInstantEvalFilter,
  expandInstantEvalShorthand,
} from "../instant-eval-shorthand.rules.ts";

const NOW = Temporal.Instant.from("2026-09-18T12:00:00.000Z");

const SERVICE: CompiledInstantEvalFilter = {
  sql: "Attributes['service.name'] = {service_0:String}",
  parameters: { service_0: "checkout" },
};

const expand = ({
  shorthand = {},
  filter,
  selection,
}: {
  shorthand?: Partial<InstantEvalShorthandInput>;
  filter?: CompiledInstantEvalFilter;
  selection?: readonly string[];
} = {}) =>
  expandInstantEvalShorthand({
    shorthand: {
      target: "traces",
      questions: [{ kind: "boolean", instructions: "The customer is annoyed" }],
      ...shorthand,
    },
    database: "analytics",
    now: NOW,
    ...(filter ? { filter } : {}),
    ...(selection ? { selection } : {}),
  });

describe("given a compiled filter", () => {
  describe("when the target is traces", () => {
    /** @scenario "A supported filter field is compiled into the statement's WHERE" */
    it("writes the condition into the statement's own WHERE", () => {
      const { sql, parameters } = expand({ filter: SERVICE });

      expect(sql).toContain("Attributes['service.name'] = {service_0:String}");
      expect(parameters.service_0).toBe("checkout");
      expect(sql).not.toContain("TraceId IN (");
    });
  });

  describe("when the target reads another view", () => {
    /** @scenario "A filter on a target other than traces is applied through a trace subquery" */
    it("applies the filter through a time-bounded subquery on the trace view", () => {
      const { sql } = expand({ shorthand: { target: "threads" }, filter: SERVICE });

      expect(sql).toContain("TraceId IN (");
      expect(sql).toContain("FROM analytics.traces");
      expect(sql).toContain("OccurredAt >= {start_at:DateTime64(3, 'UTC')}");
    });

    /** @scenario "A filtered threads statement names the view's own trace column" */
    it("names the view's own trace column, not the aggregate the statement projects", () => {
      const { sql } = expand({ shorthand: { target: "threads" }, filter: SERVICE });

      expect(sql).toContain("m.TraceId IN (");
      expect(sql).not.toContain("\n  AND TraceId IN (");
    });

    /** @scenario "A filtered llm-spans statement reads its own plain trace column" */
    it("reads the plain trace column when the projection is not an aggregate", () => {
      const { sql } = expand({ shorthand: { target: "llm_spans" }, filter: SERVICE });

      expect(sql).toContain("TraceId IN (");
      expect(sql).not.toContain("m.TraceId IN (");
    });
  });

  describe("when there is no filter", () => {
    /** @scenario "A shorthand with no filter writes no filter condition" */
    it("writes the window and nothing else", () => {
      const { sql, parameters } = expand();

      expect(sql).not.toContain("TraceId IN (");
      expect(Object.keys(parameters).toSorted()).toEqual(["end_at", "start_at"]);
    });
  });
});

describe("given a filter the trace view cannot answer, resolved to trace ids", () => {
  describe("when the shorthand is expanded with the selection", () => {
    /** @scenario "A filter the trace view cannot answer is bound as a selection when the caller resolved it" */
    it("keeps only the bound trace ids and compiles no filter text", () => {
      const { sql, parameters } = expand({ filter: SERVICE, selection: ["trace-a", "trace-b"] });

      expect(sql).toContain(`TraceId IN ({${INSTANT_EVAL_SELECTION_PARAMETER}:Array(String)})`);
      expect(sql).not.toContain("service.name");
      expect(parameters[INSTANT_EVAL_SELECTION_PARAMETER]).toEqual(["trace-a", "trace-b"]);
    });

    /** @scenario "A selection on a target other than traces is applied to the view's own trace column" */
    it("compares the threads view's own trace column to the selection", () => {
      const { sql } = expand({ shorthand: { target: "threads" }, selection: ["trace-a"] });

      expect(sql).toContain(`m.TraceId IN ({${INSTANT_EVAL_SELECTION_PARAMETER}:Array(String)})`);
    });
  });
});
