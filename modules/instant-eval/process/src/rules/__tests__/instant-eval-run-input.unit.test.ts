/**
 * Which of the two ways in a request meant, and what the gate is then handed.
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import {
  InstantEvalQueryInvalidError,
  type InstantEvalRunInput,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { instantEvalStatementFor } from "../instant-eval-run-input.rules.ts";

const NOW = Temporal.Instant.from("2026-09-18T12:00:00.000Z");

const SHORTHAND = {
  target: "traces" as const,
  questions: [{ kind: "boolean" as const, instructions: "The customer sounds annoyed" }],
};

const statementFor = (input: InstantEvalRunInput) =>
  instantEvalStatementFor({ input, database: "analytics", now: NOW });

const refusalOf = (input: InstantEvalRunInput): InstantEvalQueryInvalidError => {
  try {
    statementFor(input);
  } catch (error) {
    if (error instanceof InstantEvalQueryInvalidError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("instantEvalStatementFor, given what a caller sent", () => {
  describe("when a statement was sent", () => {
    it("takes it as written, with its own parameters", () => {
      expect(
        statementFor({ sql: "SELECT TraceId FROM traces", parameters: { since: "2026-09-01" } }),
      ).toEqual({ sql: "SELECT TraceId FROM traces", parameters: { since: "2026-09-01" } });
    });
  });

  describe("when a target was sent", () => {
    it("expands it into a statement with the values it bound", () => {
      const statement = statementFor({ shorthand: SHORTHAND });

      expect(statement.sql).toContain("FROM analytics.traces");
      expect(statement.parameters).toMatchObject({ start_at: "2026-09-11 12:00:00.000" });
    });

    it("refuses parameters of the caller's own alongside it", () => {
      expect(refusalOf({ shorthand: SHORTHAND, parameters: { since: "x" } }).message).toContain(
        "nothing for parameters to fill",
      );
    });

    it("keeps an empty parameters object, which binds nothing", () => {
      expect(statementFor({ shorthand: SHORTHAND, parameters: {} }).sql).toContain(
        "FROM analytics.traces",
      );
    });
  });

  describe("when both were sent", () => {
    it("refuses and names the two", () => {
      const refusal = refusalOf({ sql: "SELECT 1", shorthand: SHORTHAND });

      expect(refusal.message).toContain("not both");
      expect(refusal.meta.fields).toEqual(["sql", "target"]);
    });
  });

  describe("when neither was sent", () => {
    it("refuses and names both ways to ask", () => {
      expect(refusalOf({}).message).toContain("needs something to judge");
    });

    it("reads a blank statement as no statement", () => {
      expect(refusalOf({ sql: "   " }).message).toContain("needs something to judge");
    });
  });
});
