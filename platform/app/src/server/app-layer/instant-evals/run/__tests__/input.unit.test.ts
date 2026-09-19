/**
 * Which of the two ways in a request meant, and what the gate is then handed.
 *
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import { describe, expect, it } from "vitest";

import { InstantEvalQueryInvalidError } from "../errors";
import { instantEvalStatementFor } from "../input";

const statementFor = (
  input: Parameters<typeof instantEvalStatementFor>[0]["input"],
) =>
  instantEvalStatementFor({
    input,
    database: "analytics",
    now: new Date("2026-09-18T12:00:00.000Z"),
  });

const SHORTHAND = {
  target: "traces" as const,
  questions: [
    { kind: "boolean" as const, instructions: "The customer sounds annoyed" },
  ],
};

describe("instantEvalStatementFor, given what a caller sent", () => {
  describe("when a statement was sent", () => {
    it("takes it as written, with its own parameters", () => {
      const statement = statementFor({
        sql: "SELECT TraceId FROM traces",
        parameters: { since: "2026-09-01" },
      });

      expect(statement).toEqual({
        sql: "SELECT TraceId FROM traces",
        parameters: { since: "2026-09-01" },
      });
    });
  });

  describe("when a shorthand was sent", () => {
    /** @scenario "The run hands the expanded statement back" */
    it("expands it into a statement with the values it bound", () => {
      const statement = statementFor({ shorthand: SHORTHAND });

      expect(statement.sql).toContain("FROM analytics.traces");
      expect(statement.parameters).toMatchObject({
        start_at: "2026-09-11 12:00:00.000",
      });
    });

    it("refuses parameters of the caller's own alongside it", () => {
      expect(() =>
        statementFor({ shorthand: SHORTHAND, parameters: { since: "x" } }),
      ).toThrow(/nothing for parameters to fill/);
    });

    it("re-raises a refusal from the expansion under the query code", () => {
      let thrown: unknown;
      try {
        statementFor({
          shorthand: { ...SHORTHAND, filter: "evaluator:my-eval" },
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InstantEvalQueryInvalidError);
      expect((thrown as InstantEvalQueryInvalidError).meta.fields).toEqual([
        "filter",
      ]);
    });
  });

  describe("when both were sent", () => {
    /** @scenario "A request carrying both a statement and a target is refused" */
    it("refuses and names the two", () => {
      let thrown: unknown;
      try {
        statementFor({ sql: "SELECT 1", shorthand: SHORTHAND });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(InstantEvalQueryInvalidError);
      expect((thrown as Error).message).toContain("not both");
      expect((thrown as InstantEvalQueryInvalidError).meta.fields).toEqual([
        "sql",
        "target",
      ]);
    });
  });

  describe("when neither was sent", () => {
    /** @scenario "A request carrying neither a statement nor a target is refused" */
    it("refuses and names both ways to ask", () => {
      expect(() => statementFor({})).toThrow(/needs something to judge/);
    });

    it("reads a blank statement as no statement", () => {
      expect(() => statementFor({ sql: "   " })).toThrow(
        /needs something to judge/,
      );
    });
  });
});
