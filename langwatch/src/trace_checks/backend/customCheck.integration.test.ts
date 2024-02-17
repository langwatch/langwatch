import { describe, expect, it } from "vitest";
import { customCheck } from "./customCheck";
import type { Trace } from "../../server/tracer/types";
import type { Checks } from "../types";

describe("CustomCheck", () => {
  it("correctly applies the 'contains' rule", async () => {
    const sampleTrace: Trace = {
      trace_id: "trace1",
      project_id: "project1",
      metadata: {},
      input: { value: "Hello, World!" },
      output: { value: "Goodbye, World!" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const passingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "input",
          rule: "contains",
          value: "Hello",
        },
      ],
    };

    const failingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "input",
          rule: "contains",
          value: "Nonexistent",
        },
      ],
    };

    const containsResult = await customCheck(sampleTrace, [], passingRule);
    expect(containsResult.status).toBe("succeeded");
    expect((containsResult.raw_result as any).failedRules).toHaveLength(0);

    const notContainsResult = await customCheck(sampleTrace, [], failingRule);
    expect(notContainsResult.status).toBe("failed");
    expect((notContainsResult.raw_result as any).failedRules).toHaveLength(1);
  });

  it("correctly applies the 'not_contains' rule", async () => {
    const sampleTrace: Trace = {
      trace_id: "trace2",
      project_id: "project2",
      metadata: {},
      input: { value: "Hello, World!" },
      output: { value: "Goodbye, World!" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const passingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "output",
          rule: "not_contains",
          value: "Hello",
        },
      ],
    };

    const failingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "output",
          rule: "not_contains",
          value: "Goodbye",
        },
      ],
    };

    const notContainsResult = await customCheck(sampleTrace, [], passingRule);
    expect(notContainsResult.status).toBe("succeeded");
    expect((notContainsResult.raw_result as any).failedRules).toHaveLength(0);

    const containsResult = await customCheck(sampleTrace, [], failingRule);
    expect(containsResult.status).toBe("failed");
    expect((containsResult.raw_result as any).failedRules).toHaveLength(1);
  });

  it("correctly applies the 'matches_regex' and 'not_matches_regex' rules", async () => {
    const sampleTrace: Trace = {
      trace_id: "trace3",
      project_id: "project3",
      metadata: {},
      input: { value: "User123" },
      output: { value: "Error code 404" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const matchesRegexPassingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "input",
          rule: "matches_regex",
          value: "^User\\d+$",
        },
      ],
    };

    const matchesRegexFailingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "input",
          rule: "matches_regex",
          value: "^[A-Z]+$",
        },
      ],
    };

    const notMatchesRegexPassingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "output",
          rule: "not_matches_regex",
          value: "^Error number \\d+$",
        },
      ],
    };

    const notMatchesRegexFailingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "output",
          rule: "not_matches_regex",
          value: "\\d{3}$",
        },
      ],
    };

    const matchesRegexPassResult = await customCheck(
      sampleTrace,
      [],
      matchesRegexPassingRule
    );
    expect(matchesRegexPassResult.status).toBe("succeeded");
    expect((matchesRegexPassResult.raw_result as any).failedRules).toHaveLength(
      0
    );

    const matchesRegexFailResult = await customCheck(
      sampleTrace,
      [],
      matchesRegexFailingRule
    );
    expect(matchesRegexFailResult.status).toBe("failed");
    expect((matchesRegexFailResult.raw_result as any).failedRules).toHaveLength(
      1
    );

    const notMatchesRegexPassResult = await customCheck(
      sampleTrace,
      [],
      notMatchesRegexPassingRule
    );
    expect(notMatchesRegexPassResult.status).toBe("succeeded");
    expect(
      (notMatchesRegexPassResult.raw_result as any).failedRules
    ).toHaveLength(0);

    const notMatchesRegexFailResult = await customCheck(
      sampleTrace,
      [],
      notMatchesRegexFailingRule
    );
    expect(notMatchesRegexFailResult.status).toBe("failed");
    expect(
      (notMatchesRegexFailResult.raw_result as any).failedRules
    ).toHaveLength(1);
  });

  it("correctly applies the 'is_similar_to' rule", async () => {
    const sampleTrace: Trace = {
      trace_id: "trace4",
      project_id: "project4",
      metadata: {},
      input: { value: "This is a test input." },
      output: { value: "This is a test output." },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const isSimilarToPassingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "input",
          rule: "is_similar_to",
          value: "This is a test input.",
          embeddings: {
            model: "text-embedding-3-small",
            embeddings: [0.1, 0.2, 0.3],
          },
          failWhen: { condition: "<", amount: 0.5 },
        },
      ],
    };

    const isSimilarToFailingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "input",
          rule: "is_similar_to",
          value: "This is a different input.",
          embeddings: {
            model: "text-embedding-3-small",
            embeddings: [0.4, 0.5, 0.6],
          },
          failWhen: { condition: ">", amount: 0.8 },
        },
      ],
    };

    const isSimilarToPassResult = await customCheck(
      sampleTrace,
      [],
      isSimilarToPassingRule
    );
    expect(isSimilarToPassResult.status).toBe("succeeded");
    expect((isSimilarToPassResult.raw_result as any).failedRules).toHaveLength(
      0
    );

    const isSimilarToFailingResult = await customCheck(
      sampleTrace,
      [],
      isSimilarToFailingRule
    );
    expect(isSimilarToFailingResult.status).toBe("failed");
    expect(
      (isSimilarToFailingResult.raw_result as any).failedRules
    ).toHaveLength(1);
  });

  it("correctly applies the 'llm_boolean' and 'llm_score' rules", async () => {
    const sampleTrace: Trace = {
      trace_id: "trace5",
      project_id: "project5",
      metadata: {},
      input: { value: "Sample input for LLM checks." },
      output: { value: "It's sunny outside" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
    };

    const llmBooleanRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "output",
          rule: "llm_boolean",
          value: "Please answer with true or false: Is this output positive?",
          model: "gpt-3.5-turbo",
        },
      ],
    };

    const llmScoreRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "output",
          rule: "llm_score",
          value:
            "Please score from 0.0 to 1.0 how relevant this output is to the input",
          model: "gpt-3.5-turbo",
          failWhen: { condition: "<=", amount: 0.9 },
        },
      ],
    };

    const llmBooleanResult = await customCheck(sampleTrace, [], llmBooleanRule);
    expect(llmBooleanResult.status).toBe("succeeded");
    expect(llmBooleanResult.costs).toEqual([
      { currency: "USD", amount: 0.00014800000000000002 },
    ]);

    const llmScoreResult = await customCheck(sampleTrace, [], llmScoreRule);
    expect(llmScoreResult.status).toBe("failed");
    expect(llmScoreResult.costs).toEqual([
      { currency: "USD", amount: 0.0001645 },
    ]);
    expect((llmScoreResult.raw_result as any).failedRules).toHaveLength(1);
  });
});
