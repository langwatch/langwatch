/**
 * The eval functions through the real ClickHouse parser: the one nesting that
 * is allowed, the arguments that are not, and the gate.
 *
 * Every refusal is paired with a control that is accepted, for the reason the
 * sibling suite documents: a case that went green because the query was
 * unparseable or the table wrong would be reporting a guard that is not there.
 *
 * @see ../../appFunctions/evalCatalog.ts
 * @see specs/lwql/eval-functions.feature
 */
import { describe, expect, it } from "vitest";

import { type LangWatchQLValidation, validateLangWatchQL } from "../validate";
import type { LangWatchQLViolationCode } from "../violations";

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

function validate(
  projection: string,
  overrides: Partial<typeof POLICY> = {},
): LangWatchQLValidation {
  return validateLangWatchQL({
    sql:
      `SELECT ConversationId, ${projection} FROM analytics.trace_metrics ` +
      "WHERE OccurredAt >= subtractDays(now(), 7) GROUP BY ConversationId",
    ...POLICY,
    ...overrides,
  });
}

function codesOf(result: LangWatchQLValidation): LangWatchQLViolationCode[] {
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

function messagesOf(result: LangWatchQLValidation): string {
  return result.ok
    ? ""
    : result.violations.map((violation) => violation.message).join("\n");
}

describe("given an eval function over an extraction function", () => {
  describe("when it is an aliased element of the top-level SELECT list", () => {
    /** @scenario "One question over an extracted conversation is accepted and planned" */
    it("accepts it and records the nested call as the plan's source", () => {
      const result = validate(
        "eval(conversation(ConversationId), 'The customer sounds annoyed') AS annoyed",
      );

      expect(codesOf(result)).toEqual([]);
      expect(result.ok && result.appFunctions).toEqual([
        {
          column: "annoyed",
          function: "eval",
          options: ["The customer sounds annoyed"],
          source: { function: "conversation", options: [] },
        },
      ]);
    });

    it("keeps the nested call's own options in the plan", () => {
      const result = validate(
        "eval(conversation_bounded(ConversationId, 8000, ''), 'Annoyed') AS annoyed",
      );

      expect(result.ok && result.appFunctions[0]?.source).toEqual({
        function: "conversation_bounded",
        options: [8000, ""],
      });
    });
  });

  describe("when the text is a plain column rather than a function", () => {
    /** @scenario "An eval over a plain column needs no extraction read" */
    it("accepts it and records no source", () => {
      const result = validateLangWatchQL({
        sql:
          "SELECT TraceId, eval(CapturedOutput, 'The answer is an apology') AS apology " +
          "FROM analytics.traces WHERE OccurredAt >= subtractDays(now(), 1)",
        ...POLICY,
      });

      expect(codesOf(result)).toEqual([]);
      expect(result.ok && result.appFunctions[0]?.source).toBeUndefined();
    });
  });
});

describe("given a call outside the projection", () => {
  describe("when the function is an eval function", () => {
    /** @scenario "An eval function used outside the projection is told what to do instead" */
    it("does not send the caller looking for a column to filter on", () => {
      const refused = validateLangWatchQL({
        sql:
          "SELECT ConversationId FROM analytics.trace_metrics " +
          "WHERE eval(CapturedOutput, 'the customer sounds annoyed')",
        ...POLICY,
      });

      expect(codesOf(refused)).toContain("APP_FUNCTION_POSITION");
      // An eval answers after the query has run, so the statement holds no
      // column carrying its verdict. The old advice pointed at one.
      expect(messagesOf(refused)).not.toContain("on a plain column instead");
      expect(messagesOf(refused)).toContain(
        "there is no column in this statement to filter on",
      );
      expect(messagesOf(refused)).toContain(
        "instant-eval results <run-id> --matched",
      );
    });
  });

  describe("when the function is an extraction function", () => {
    /** @scenario "An extraction function used outside the projection keeps its advice" */
    it("still points at projecting it and filtering on a plain column", () => {
      const refused = validateLangWatchQL({
        sql:
          "SELECT ConversationId FROM analytics.trace_metrics " +
          "WHERE conversation(ConversationId) != ''",
        ...POLICY,
      });

      expect(codesOf(refused)).toContain("APP_FUNCTION_POSITION");
      expect(messagesOf(refused)).toContain(
        "filter, group or sort on a plain column instead",
      );
      expect(messagesOf(refused)).not.toContain("instant-eval results");
    });
  });
});

describe("given nesting the validator does not allow", () => {
  describe("when an eval is nested inside an eval", () => {
    /** @scenario "An eval nested inside an eval is refused" */
    it("refuses it by position", () => {
      expect(
        codesOf(validate("eval(eval(CapturedOutput, 'a'), 'b') AS nested")),
      ).toContain("APP_FUNCTION_POSITION");
    });
  });

  describe("when an extraction function is nested two levels deep", () => {
    /** @scenario "An extraction function nested two levels deep is refused" */
    it("refuses the inner one by position", () => {
      expect(
        codesOf(
          validate(
            "eval(conversation(conversation(ConversationId)), 'a') AS deep",
          ),
        ),
      ).toContain("APP_FUNCTION_POSITION");
    });
  });

  describe("when an eval is nested inside an extraction function", () => {
    /** @scenario "An extraction function still may not nest an eval function" */
    it("refuses it by position", () => {
      expect(
        codesOf(
          validate("conversation(eval(CapturedOutput, 'a')) AS transcript"),
        ),
      ).toContain("APP_FUNCTION_POSITION");
    });
  });

  describe("when an eval is used as a filter", () => {
    /** @scenario "An eval in WHERE is refused rather than silently comparing the text" */
    it("refuses it rather than comparing the text the database holds", () => {
      const result = validateLangWatchQL({
        sql:
          "SELECT TraceId FROM analytics.traces " +
          "WHERE eval(CapturedOutput, 'anything') > 0.5",
        ...POLICY,
      });

      expect(codesOf(result)).toContain("APP_FUNCTION_POSITION");
    });
  });
});

describe("given arguments that do not match a signature", () => {
  describe("when eval is called with a criteria argument", () => {
    /** @scenario "eval takes two arguments, and the criteria form is its own function" */
    it("refuses the arity and names the function that takes one", () => {
      const result = validate("eval(CapturedOutput, 'a', ['yes', 'no']) AS x");

      expect(codesOf(result)).toContain("APP_FUNCTION_ARGUMENT");
      expect(messagesOf(result)).toContain("eval_criteria");
    });
  });

  describe("when the criteria list is not a pair", () => {
    /** @scenario "The criteria argument is two strings, what counts as yes and what does not" */
    it("refuses a single criterion", () => {
      expect(
        codesOf(validate("eval_criteria(CapturedOutput, 'a', ['yes']) AS x")),
      ).toContain("APP_FUNCTION_ARGUMENT");
    });

    it("accepts the pair", () => {
      expect(
        codesOf(
          validate("eval_criteria(CapturedOutput, 'a', ['yes', 'no']) AS x"),
        ),
      ).toEqual([]);
    });
  });

  describe("when a category is given too few options", () => {
    /** @scenario "A category needs between two and 255 options" */
    it("refuses a single option", () => {
      expect(
        codesOf(
          validate("eval_category(CapturedOutput, 'a', ['one: only']) AS x"),
        ),
      ).toContain("APP_FUNCTION_ARGUMENT");
    });
  });

  describe("when a category option carries no description", () => {
    /** @scenario "A category option is written as name and description" */
    it("refuses it", () => {
      expect(
        codesOf(
          validate(
            "eval_category(CapturedOutput, 'a', ['refund', 'bug: broken']) AS x",
          ),
        ),
      ).toContain("APP_FUNCTION_ARGUMENT");
    });

    it("accepts options written as name and description", () => {
      expect(
        codesOf(
          validate(
            "eval_category(CapturedOutput, 'a', ['refund: money back', 'bug: broken']) AS x",
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("when a score range runs downwards", () => {
    /** @scenario "A score range must run upwards" */
    it("refuses it", () => {
      expect(
        codesOf(validate("eval_score(CapturedOutput, 'a', 5, 1) AS x")),
      ).toContain("APP_FUNCTION_ARGUMENT");
    });

    it("accepts a range that runs upwards, including from zero", () => {
      expect(
        codesOf(validate("eval_score(CapturedOutput, 'a', 0, 9) AS x")),
      ).toEqual([]);
    });
  });

  describe("when a score range asks for more levels than the judge weighs", () => {
    /** @scenario "A score range holds at most ten levels" */
    it("refuses the eleventh level here rather than once per row at the judge", () => {
      // Measured: `eval_score(text, 'x', 0, 10)` is eleven levels, which the
      // live API refuses with "Too many score levels. Must have at most 10
      // levels." Refusing it in the validator turns that into one message
      // about the statement.
      const result = validate("eval_score(CapturedOutput, 'a', 0, 10) AS x");

      expect(codesOf(result)).toContain("APP_FUNCTION_ARGUMENT");
      expect(messagesOf(result)).toContain("at most 10 levels");
    });
  });

  describe("when a threshold is outside zero to one", () => {
    /** @scenario "A threshold outside zero to one is refused" */
    it("refuses it", () => {
      expect(
        codesOf(validate("eval_passed(CapturedOutput, 'a', 2) AS x")),
      ).toContain("APP_FUNCTION_ARGUMENT");
    });

    it("accepts a fractional threshold inside the range", () => {
      expect(
        codesOf(validate("eval_passed(CapturedOutput, 'a', 0.7) AS x")),
      ).toEqual([]);
    });
  });

  describe("when a score scale runs below zero", () => {
    it("accepts a negative bound, which the parser reports as a signed literal", () => {
      // The parser reports `-3` as one `Literal` of type `Int64` with the
      // value "-3" rather than as a negation applied to `3`, so the bound is
      // read straight off the literal. Pinned because a parser that changed
      // that would silently refuse every scale below zero.
      expect(
        codesOf(validate("eval_score(CapturedOutput, 'a', -3, 2) AS x")),
      ).toEqual([]);
    });

    it("still refuses a negative bound that runs the scale downwards", () => {
      expect(
        codesOf(validate("eval_score(CapturedOutput, 'a', -3, -9) AS x")),
      ).toContain("APP_FUNCTION_ARGUMENT");
    });
  });

  describe("when the instructions are read from a column", () => {
    /** @scenario "An instruction read from a column rather than written in the query is refused" */
    it("refuses it, because the plan is built before a row comes back", () => {
      expect(
        codesOf(validate("eval(CapturedOutput, ConversationId) AS x")),
      ).toContain("APP_FUNCTION_ARGUMENT");
    });
  });
});

describe("given a project the feature is not open to", () => {
  describe("when an eval function is called", () => {
    /** @scenario "An eval function is refused while the flag is off for the project" */
    it("refuses it and says the feature is not switched on", () => {
      const result = validate("eval(CapturedOutput, 'a') AS x", {
        instantEvalsEnabled: false,
      });

      expect(codesOf(result)).toContain("APP_FUNCTION_GATED");
      expect(messagesOf(result)).toContain("Instant Evals switched on");
    });

    it("still admits an extraction function, which is not gated on it", () => {
      expect(
        codesOf(
          validate("conversation(ConversationId) AS transcript", {
            instantEvalsEnabled: false,
          }),
        ),
      ).toEqual([]);
    });
  });
});

describe("given a caller without the content permissions", () => {
  describe("when an eval reads a conversation", () => {
    /** @scenario "An eval function still needs the content permissions its text carries" */
    it("refuses the nested extraction by its own gates", () => {
      const result = validate(
        "eval(conversation(ConversationId), 'a') AS annoyed",
        { heldPermissions: ["input"] },
      );

      expect(codesOf(result)).toContain("APP_FUNCTION_GATED");
      expect(result.ok).toBe(false);
    });
  });
});
