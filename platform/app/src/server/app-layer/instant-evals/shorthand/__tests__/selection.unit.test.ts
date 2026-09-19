/**
 * A filter the trace view cannot answer, resolved into a bound selection.
 *
 * Spec: specs/instant-evals/instant-eval-shorthand.feature ("The trace
 * filter").
 */
import { describe, expect, it, vi } from "vitest";
import { InstantEvalQueryInvalidError } from "../../run/errors";
import { resolveInstantEvalStatement } from "../../run/input";
import {
  expandInstantEvalShorthand,
  INSTANT_EVAL_SELECTION_PARAMETER,
} from "../expand";
import {
  compileInstantEvalShorthandFilter,
  isShorthandFilterFieldUnsupported,
} from "../filter";
import { InstantEvalShorthandError } from "../questions";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const QUESTIONS = [
  { kind: "boolean" as const, instructions: "The customer sounds annoyed" },
];

describe("given a filter naming an evaluator result", () => {
  describe("when the shorthand is expanded with a resolved selection", () => {
    /** @scenario "A filter the trace view cannot answer is bound as a selection when the caller resolved it" */
    it("keeps only the bound trace ids and compiles no filter text", () => {
      const expanded = expandInstantEvalShorthand({
        shorthand: {
          target: "traces",
          filter: "evaluatorVerdict:fail",
          questions: QUESTIONS,
        },
        database: "analytics",
        now: NOW,
        selection: ["trace-a", "trace-b"],
      });
      expect(expanded.sql).toContain(
        `TraceId IN ({${INSTANT_EVAL_SELECTION_PARAMETER}:Array(String)})`,
      );
      expect(expanded.sql).not.toContain("evaluatorVerdict");
      expect(expanded.parameters[INSTANT_EVAL_SELECTION_PARAMETER]).toEqual([
        "trace-a",
        "trace-b",
      ]);
    });

    /** @scenario "A selection on a target other than traces is applied to the view's own trace column" */
    it("compares the threads view's own trace column to the selection", () => {
      const expanded = expandInstantEvalShorthand({
        shorthand: {
          target: "threads",
          filter: "evaluatorVerdict:fail",
          questions: QUESTIONS,
        },
        database: "analytics",
        now: NOW,
        selection: ["trace-a"],
      });
      expect(expanded.sql).toContain(
        `m.TraceId IN ({${INSTANT_EVAL_SELECTION_PARAMETER}:Array(String)})`,
      );
    });
  });

  describe("when the filter is compiled", () => {
    /** @scenario "A refusal for a field the trace view cannot answer is told apart from any other refusal" */
    it("carries the unsupported-field code, and a parse failure carries none", () => {
      let unsupported: unknown;
      try {
        compileInstantEvalShorthandFilter("evaluatorVerdict:fail");
      } catch (error) {
        unsupported = error;
      }
      expect(unsupported).toBeInstanceOf(InstantEvalShorthandError);
      expect(isShorthandFilterFieldUnsupported(unsupported)).toBe(true);

      let unparsable: unknown;
      try {
        compileInstantEvalShorthandFilter("service:(api");
      } catch (error) {
        unparsable = error;
      }
      expect(unparsable).toBeInstanceOf(InstantEvalShorthandError);
      expect(isShorthandFilterFieldUnsupported(unparsable)).toBe(false);
    });
  });
});

describe("given the run service's statement step and a selection resolver", () => {
  describe("when the dialect refuses the filter by field", () => {
    /** @scenario "The run service resolves the selection itself when the dialect refuses the filter" */
    it("asks the resolver once, with the window and the filter, and binds what it answers", async () => {
      const resolveSelection = vi.fn(async () => ["trace-a", "trace-b"]);
      const statement = await resolveInstantEvalStatement({
        input: {
          shorthand: {
            target: "traces",
            filter: "evaluatorVerdict:fail AND service:api",
            start: "2026-09-10T00:00:00.000Z",
            end: "2026-09-11T00:00:00.000Z",
            questions: QUESTIONS,
          },
        },
        database: "analytics",
        now: NOW,
        resolveSelection,
      });
      expect(resolveSelection).toHaveBeenCalledTimes(1);
      expect(resolveSelection).toHaveBeenCalledWith({
        filter: "evaluatorVerdict:fail AND service:api",
        window: {
          from: Date.UTC(2026, 8, 10),
          to: Date.UTC(2026, 8, 11),
        },
      });
      expect(statement.parameters?.[INSTANT_EVAL_SELECTION_PARAMETER]).toEqual([
        "trace-a",
        "trace-b",
      ]);
      expect(statement.sql).not.toContain("evaluatorVerdict");
    });

    it("still refuses when no resolver is wired", async () => {
      await expect(
        resolveInstantEvalStatement({
          input: {
            shorthand: {
              target: "traces",
              filter: "evaluatorVerdict:fail",
              questions: QUESTIONS,
            },
          },
          database: "analytics",
          now: NOW,
        }),
      ).rejects.toBeInstanceOf(InstantEvalQueryInvalidError);
    });

    it("does not resolve a filter the language cannot parse", async () => {
      const resolveSelection = vi.fn(async () => []);
      await expect(
        resolveInstantEvalStatement({
          input: {
            shorthand: {
              target: "traces",
              filter: "service:(api",
              questions: QUESTIONS,
            },
          },
          database: "analytics",
          now: NOW,
          resolveSelection,
        }),
      ).rejects.toBeInstanceOf(InstantEvalQueryInvalidError);
      expect(resolveSelection).not.toHaveBeenCalled();
    });
  });
});
