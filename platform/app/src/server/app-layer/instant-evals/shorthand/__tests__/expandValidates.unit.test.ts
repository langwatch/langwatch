/**
 * Every expanded statement, through the real query validator.
 *
 * The expansion writes SQL, so the only test worth having is whether the query
 * policy accepts what it writes: a template that projected a column the view
 * does not publish, nested a function the walk refuses, or wrote an option the
 * argument reader will not take is a shorthand that is refused at the door for
 * a statement the caller never saw. This drives the shipped parser and the
 * shipped policy, so a catalog or policy change that breaks a template fails
 * here rather than in production.
 *
 * @see specs/instant-evals/instant-eval-shorthand.feature
 */

import { describe, expect, it } from "vitest";

import {
  type LangWatchQLValidation,
  validateLangWatchQL,
} from "~/server/analytics/lwql/validation/validate";
import {
  expandInstantEvalShorthand,
  INSTANT_EVAL_TARGETS,
  type InstantEvalShorthandInput,
} from "..";

const POLICY = {
  allowedTables: [
    "analytics.traces",
    "analytics.spans",
    "analytics.trace_metrics",
  ],
  gatedColumns: [] as readonly string[],
  heldPermissions: ["input", "output", "costs"] as readonly string[],
  instantEvalsEnabled: true,
  defaultDatabase: "analytics",
};

const QUESTIONS: InstantEvalShorthandInput["questions"] = [
  { kind: "boolean", instructions: "The customer sounds annoyed" },
  {
    kind: "boolean",
    instructions: "The agent apologised",
    criteria: ["an explicit apology counts", "a neutral reply does not"],
  },
  { kind: "boolean", instructions: "The request was resolved", threshold: 0.7 },
  {
    kind: "score",
    instructions: "How satisfied is the customer",
    range: { min: 1, max: 5 },
  },
  {
    kind: "category",
    instructions: "What is being asked for",
    options: [
      { name: "refund", description: "wants money back" },
      { name: "bug", description: "something is broken" },
    ],
  },
];

const FILTER =
  "(service:checkout OR model:gpt-5*) AND cost:>0.01 AND " +
  "trace.attribute.tenant:acme AND NOT status:error AND label:beta";

function validated(
  shorthand: Partial<InstantEvalShorthandInput>,
): LangWatchQLValidation {
  const { sql } = expandInstantEvalShorthand({
    shorthand: {
      target: "traces",
      questions: QUESTIONS,
      ...shorthand,
    } as InstantEvalShorthandInput,
    database: "analytics",
    now: new Date("2026-09-18T12:00:00.000Z"),
  });
  return validateLangWatchQL({ sql, ...POLICY });
}

function refusal(result: LangWatchQLValidation): string {
  return result.ok
    ? ""
    : result.violations
        .map((violation) => `${violation.code}: ${violation.message}`)
        .join("\n");
}

describe("the expanded statement, given the shipped query policy", () => {
  for (const target of INSTANT_EVAL_TARGETS) {
    describe(`when the target is ${target}`, () => {
      /** @scenario "An expanded statement passes the statement gate unchanged" */
      it("is accepted with every kind of question on it", () => {
        const result = validated({ target });

        expect(result.ok, refusal(result)).toBe(true);
      });

      it("is accepted with a filter that exercises every shape of condition", () => {
        const result = validated({ target, filter: FILTER });

        expect(result.ok, refusal(result)).toBe(true);
      });

      it("declares the window parameters and whatever the filter bound", () => {
        const result = validated({ target, filter: "service:checkout" });

        expect(result.ok, refusal(result)).toBe(true);
        if (!result.ok) return;
        expect(result.parameters.map((one) => one.name).sort()).toEqual([
          "end_at",
          "service_0",
          "start_at",
        ]);
      });

      it("records one hydration call per question plus its extraction", () => {
        const result = validated({ target });

        expect(result.ok, refusal(result)).toBe(true);
        if (!result.ok) return;
        expect(result.appFunctions.map((call) => call.column).sort()).toEqual([
          "q1",
          "q2",
          "q3",
          "q4",
          "q5",
        ]);
      });
    });
  }
});
