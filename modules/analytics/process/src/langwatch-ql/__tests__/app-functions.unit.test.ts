/**
 * App functions through the real parser: where they are admitted and every
 * position where they are not. Each refusal is paired with a control.
 * @see specs/lwql/app-functions.feature
 */

import type { LangWatchQLViolationCode } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { LWQL_APP_FUNCTION_CATALOG } from "../../rules/langwatch-ql-app-function-catalog.rules.ts";
import type { LangWatchQLValidation } from "../../rules/langwatch-ql-validation-shape.rules.ts";
import { validateLangWatchQL } from "./lwql-validate.ts";

const POLICY = {
  allowedTables: ["analytics.traces", "analytics.spans", "analytics.trace_metrics"],
  gatedColumns: [] as readonly string[],
  heldPermissions: ["input", "output", "costs"] as readonly string[],
  defaultDatabase: "analytics",
};

function validate(sql: string, overrides: Partial<typeof POLICY> = {}): LangWatchQLValidation {
  return validateLangWatchQL({ sql, ...POLICY, ...overrides });
}

function codesOf(result: LangWatchQLValidation): LangWatchQLViolationCode[] {
  return result.ok ? [] : result.violations.map((violation) => violation.code);
}

function messagesOf(result: LangWatchQLValidation): string {
  return result.ok ? "" : result.violations.map((violation) => violation.message).join("\n");
}

/** One argument of the right shape for a parameter, to exercise the gate. */
function exampleArgument(parameter: { role: string; type: string }): string {
  if (parameter.role === "key") return "TraceId";
  return parameter.type === "number" ? "8000" : "''";
}

function planOf(result: LangWatchQLValidation) {
  return result.ok ? result.appFunctions : [];
}

describe("given a statement that calls a LangWatchQL app function", () => {
  describe("when the call is written in the parametric form", () => {
    /** @scenario "A call in the parametric form is refused" */
    it("refuses it, naming the function, rather than letting the parameter list through", () => {
      const result = validate("SELECT conversation(1)(ConversationId) AS c FROM analytics.traces");

      expect(codesOf(result)).toEqual(["APP_FUNCTION_ARGUMENT"]);
      expect(messagesOf(result)).toContain('"conversation"');
    });

    it("refuses an empty parameter list the same way", () => {
      const result = validate("SELECT conversation()(ConversationId) AS c FROM analytics.traces");

      expect(codesOf(result)).toEqual(["APP_FUNCTION_ARGUMENT"]);
    });

    it("refuses the parametric form on the extraction nested inside an eval", () => {
      const result = validate(
        "SELECT eval(conversation(1)(ConversationId), 'annoyed') AS c FROM analytics.traces",
        {},
      );

      expect(codesOf(result)).toContain("APP_FUNCTION_ARGUMENT");
      expect(messagesOf(result)).toContain('"conversation"');
    });
  });

  describe("when the call is an aliased element of the top-level SELECT list", () => {
    /** @scenario "A conversation is projected under an alias and hydrated into the result" */
    it("accepts it and records the column, the function and its options", () => {
      const result = validate(
        "SELECT ConversationId, conversation_bounded(ConversationId, 8000, '') AS transcript " +
          "FROM analytics.trace_metrics " +
          "WHERE OccurredAt >= subtractDays(now(), 7) " +
          "GROUP BY ConversationId",
      );

      expect(codesOf(result)).toEqual([]);
      expect(planOf(result)).toEqual([
        { column: "transcript", function: "conversation_bounded", options: [8000, ""] },
      ]);
    });

    /** @scenario "A key argument may be any expression the policy already allows" */
    it("accepts any expression the policy already allows as the key", () => {
      const result = validate(
        "SELECT llm_readable_trace(concat(TraceId, ''), 8000) AS text FROM analytics.traces",
      );

      expect(codesOf(result)).toEqual([]);
      expect(planOf(result).map((call) => call.column)).toEqual(["text"]);
    });

    it("records one entry per call, in projection order", () => {
      const result = validate(
        "SELECT llm_messages(TraceId) AS a, trace_json(TraceId) AS b FROM analytics.traces",
      );

      expect(planOf(result).map((call) => call.function)).toEqual(["llm_messages", "trace_json"]);
    });

    /** @scenario "A statement that calls no app function records an empty plan" */
    it("records an empty plan for a statement that calls none", () => {
      expect(planOf(validate("SELECT TraceId FROM analytics.traces"))).toEqual([]);
    });
  });

  describe("when the name is spelled with different capitalisation", () => {
    /** @scenario "An app function written in another capitalisation is refused" */
    it("refuses it rather than planning a statement the database cannot run", () => {
      const result = validate(
        "SELECT CONVERSATION(ConversationId) AS transcript FROM analytics.trace_metrics",
      );

      expect(codesOf(result)).toContain("APP_FUNCTION_NAME_CASE");
      expect(planOf(result)).toEqual([]);
    });

    it("names the spelling to use", () => {
      const result = validate(
        "SELECT Conversation(ConversationId) AS transcript FROM analytics.trace_metrics",
      );

      expect(messagesOf(result)).toContain('as "conversation"');
    });
  });

  describe("when the call sits anywhere but the top-level SELECT list", () => {
    /** @scenario "An app function in WHERE is refused rather than silently comparing the key" */
    it("accepts the same statement with the call moved into the projection", () => {
      expect(
        codesOf(
          validate(
            "SELECT TraceId, conversation(ConversationId) AS transcript FROM analytics.trace_metrics",
          ),
        ),
      ).toEqual([]);
    });

    it("refuses it in WHERE, where the database would compare the raw key", () => {
      const result = validate(
        "SELECT TraceId FROM analytics.trace_metrics WHERE conversation(ConversationId) = 'anything'",
      );

      expect(codesOf(result)).toContain("APP_FUNCTION_POSITION");
    });

    /** @scenario "An app function outside the outermost projection is refused" */
    it.each([
      [
        "a GROUP BY expression",
        "SELECT count() AS c FROM analytics.traces GROUP BY llm_messages(TraceId)",
      ],
      [
        "an ORDER BY expression",
        "SELECT TraceId FROM analytics.traces ORDER BY llm_messages(TraceId)",
      ],
      [
        "a HAVING expression",
        "SELECT count() AS c FROM analytics.traces GROUP BY TraceId HAVING llm_messages(TraceId) != ''",
      ],
      [
        "a join condition",
        "SELECT a.TraceId FROM analytics.traces AS a " +
          "INNER JOIN analytics.spans AS b ON llm_messages(a.TraceId) = b.TraceId",
      ],
      [
        "a subquery's projection",
        "SELECT t FROM (SELECT llm_messages(TraceId) AS t FROM analytics.traces)",
      ],
      [
        "a common table expression",
        "WITH q AS (SELECT llm_messages(TraceId) AS t FROM analytics.traces) SELECT t FROM q",
      ],
      ["a lambda body", "SELECT arrayMap(x -> llm_messages(x), ['a']) AS m FROM analytics.traces"],
      [
        "a nested function argument",
        "SELECT concat(llm_messages(TraceId), '') AS m FROM analytics.traces",
      ],
    ])("refuses it in %s", (_position, sql) => {
      expect(codesOf(validate(sql))).toContain("APP_FUNCTION_POSITION");
    });

    /** @scenario "An app function nested inside another app function is refused" */
    it("refuses a call nested inside another app function", () => {
      const result = validate(
        "SELECT conversation(thread_traces(ConversationId)) AS x FROM analytics.trace_metrics",
      );

      expect(codesOf(result)).toContain("APP_FUNCTION_POSITION");
    });

    /** @scenario "An app function in a UNION branch is refused" */
    it("refuses a call in a UNION branch, where one column would hold two meanings", () => {
      const result = validate(
        "SELECT llm_messages(TraceId) AS m FROM analytics.traces " +
          "UNION ALL " +
          "SELECT llm_messages(TraceId) AS m FROM analytics.spans",
      );

      expect(codesOf(result)).toContain("APP_FUNCTION_POSITION");
      expect(messagesOf(result)).toContain("single SELECT statement");
    });

    it("names the function it refused, so the caller knows which call to move", () => {
      expect(
        messagesOf(
          validate(
            "SELECT TraceId FROM analytics.trace_metrics WHERE conversation(ConversationId) = 'x'",
          ),
        ),
      ).toContain("conversation");
    });
  });

  describe("when the call has no alias", () => {
    /** @scenario "A call with no alias is refused" */
    it("refuses it, because hydration finds the call by output column name", () => {
      const result = validate("SELECT conversation(ConversationId) FROM analytics.trace_metrics");

      expect(codesOf(result)).toEqual(["APP_FUNCTION_ALIAS_REQUIRED"]);
      expect(messagesOf(result)).toContain("AS my_column");
    });
  });

  describe("when the arguments do not match the one signature", () => {
    /** @scenario "A call whose arguments do not match the signature is refused" */
    it.each([
      ["no arguments", "SELECT conversation() AS x FROM analytics.trace_metrics"],
      [
        "too many arguments",
        "SELECT conversation(ConversationId, 1) AS x FROM analytics.trace_metrics",
      ],
      ["a missing option", "SELECT llm_readable_trace(TraceId) AS x FROM analytics.traces"],
      [
        "one option of two",
        "SELECT conversation_bounded(ConversationId, 8000) AS x FROM analytics.trace_metrics",
      ],
      [
        "a column where an option must be a literal",
        "SELECT llm_readable_trace(TraceId, TotalTokens) AS x FROM analytics.traces",
      ],
      [
        "a bound parameter where an option must be a literal",
        "SELECT llm_readable_trace(TraceId, {budget:UInt32}) AS x FROM analytics.traces",
      ],
      [
        "a quoted number where a number is required",
        "SELECT llm_readable_trace(TraceId, '8000') AS x FROM analytics.traces",
      ],
      [
        "a negative token budget",
        "SELECT llm_readable_trace(TraceId, -1) AS x FROM analytics.traces",
      ],
      [
        "a number where text is required",
        "SELECT conversation_bounded(ConversationId, 8000, 1) AS x FROM analytics.trace_metrics",
      ],
    ])("refuses %s", (_case, sql) => {
      expect(codesOf(validate(sql))).toContain("APP_FUNCTION_ARGUMENT");
    });

    it("records no plan entry for a refused call", () => {
      expect(
        planOf(
          validate(
            "SELECT conversation_bounded(ConversationId, 8000) AS x FROM analytics.trace_metrics",
          ),
        ),
      ).toEqual([]);
    });
  });

  describe("when the caller does not hold the permissions the function needs", () => {
    /** @scenario "A function whose gates the caller does not hold is refused" */
    it("refuses the call and names the permission", () => {
      const result = validate(
        "SELECT conversation(ConversationId) AS transcript FROM analytics.trace_metrics",
        { heldPermissions: ["input"] },
      );

      expect(codesOf(result)).toEqual(["APP_FUNCTION_GATED"]);
      expect(messagesOf(result)).toContain("output");
    });

    it("refuses every gated function for a caller holding nothing", () => {
      for (const definition of LWQL_APP_FUNCTION_CATALOG) {
        if (definition.gates.length === 0) continue;
        const args = definition.parameters.map(exampleArgument).join(", ");
        const result = validate(`SELECT ${definition.name}(${args}) AS x FROM analytics.traces`, {
          heldPermissions: [],
        });

        expect(
          codesOf(result),
          `${definition.name} must be refused for a caller holding no permission`,
        ).toContain("APP_FUNCTION_GATED");
      }
    });

    it("admits the ungated function for a caller holding nothing", () => {
      expect(
        codesOf(
          validate("SELECT thread_traces(ConversationId) AS ids FROM analytics.trace_metrics", {
            heldPermissions: [],
          }),
        ),
      ).toEqual([]);
    });

    /** @scenario "A gated column inside a key expression is still refused" */
    it("still refuses a gated column inside the key expression", () => {
      const result = validate(
        "SELECT thread_traces(CapturedInput) AS ids FROM analytics.trace_metrics",
        { gatedColumns: ["capturedinput"], heldPermissions: [] },
      );

      expect(codesOf(result)).toContain("GATED_COLUMN");
    });
  });

  describe("when an app function is spelled in another case outside the projection", () => {
    it("recognises it and refuses it as a position violation, not an unknown name", () => {
      const result = validate(
        "SELECT TraceId FROM analytics.trace_metrics WHERE CONVERSATION(ConversationId) = 'x'",
      );

      expect(codesOf(result)).toContain("APP_FUNCTION_POSITION");
      expect(codesOf(result)).not.toContain("FUNCTION_NOT_ALLOWED");
    });
  });
});
