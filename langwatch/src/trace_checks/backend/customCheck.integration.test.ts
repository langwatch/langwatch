import { describe, expect, it } from "vitest";
import { CustomCheck } from "./customCheck";
import type { Trace } from "../../server/tracer/types";
import type { Checks } from "../types";

describe("CustomCheck", () => {
  it("correctly applies the 'contains' rule", async () => {
    const sampleTrace: Trace = {
      id: "trace1",
      project_id: "project1",
      input: { value: "Hello, World!" },
      output: { value: "Goodbye, World!" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
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

    const containsResult = await CustomCheck.execute(
      sampleTrace,
      [],
      passingRule
    );
    expect(containsResult.status).toBe("succeeded");
    expect((containsResult.raw_result as any).failedRules).toHaveLength(0);

    const notContainsResult = await CustomCheck.execute(
      sampleTrace,
      [],
      failingRule
    );
    expect(notContainsResult.status).toBe("failed");
    expect((notContainsResult.raw_result as any).failedRules).toHaveLength(1);
  });

  it("correctly applies the 'not_contains' rule", async () => {
    const sampleTrace: Trace = {
      id: "trace2",
      project_id: "project2",
      input: { value: "Hello, World!" },
      output: { value: "Goodbye, World!" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
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

    const notContainsResult = await CustomCheck.execute(
      sampleTrace,
      [],
      passingRule
    );
    expect(notContainsResult.status).toBe("succeeded");
    expect((notContainsResult.raw_result as any).failedRules).toHaveLength(0);

    const containsResult = await CustomCheck.execute(
      sampleTrace,
      [],
      failingRule
    );
    expect(containsResult.status).toBe("failed");
    expect((containsResult.raw_result as any).failedRules).toHaveLength(1);
  });

  it("correctly applies the 'matches_regex' and 'not_matches_regex' rules", async () => {
    const sampleTrace: Trace = {
      id: "trace3",
      project_id: "project3",
      input: { value: "User123" },
      output: { value: "Error code 404" },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [] },
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

    const matchesRegexPassResult = await CustomCheck.execute(
      sampleTrace,
      [],
      matchesRegexPassingRule
    );
    expect(matchesRegexPassResult.status).toBe("succeeded");
    expect((matchesRegexPassResult.raw_result as any).failedRules).toHaveLength(
      0
    );

    const matchesRegexFailResult = await CustomCheck.execute(
      sampleTrace,
      [],
      matchesRegexFailingRule
    );
    expect(matchesRegexFailResult.status).toBe("failed");
    expect((matchesRegexFailResult.raw_result as any).failedRules).toHaveLength(
      1
    );

    const notMatchesRegexPassResult = await CustomCheck.execute(
      sampleTrace,
      [],
      notMatchesRegexPassingRule
    );
    expect(notMatchesRegexPassResult.status).toBe("succeeded");
    expect(
      (notMatchesRegexPassResult.raw_result as any).failedRules
    ).toHaveLength(0);

    const notMatchesRegexFailResult = await CustomCheck.execute(
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
      id: "trace4",
      project_id: "project4",
      input: { value: "This is a test input." },
      output: { value: "This is a test output." },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: { openai_embeddings: [0.1, 0.2, 0.3] },
    };

    const isSimilarToPassingRule: Checks["custom"]["parameters"] = {
      rules: [
        {
          field: "input",
          rule: "is_similar_to",
          value: "This is a test input.",
          openai_embeddings: [0.1, 0.2, 0.3],
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
          openai_embeddings: [0.4, 0.5, 0.6],
          failWhen: { condition: ">", amount: 0.8 },
        },
      ],
    };

    const isSimilarToPassResult = await CustomCheck.execute(
      sampleTrace,
      [],
      isSimilarToPassingRule
    );
    expect(isSimilarToPassResult.status).toBe("succeeded");
    expect((isSimilarToPassResult.raw_result as any).failedRules).toHaveLength(
      0
    );

    const isSimilarToFailingResult = await CustomCheck.execute(
      sampleTrace,
      [],
      isSimilarToFailingRule
    );
    expect(isSimilarToFailingResult.status).toBe("failed");
    expect(
      (isSimilarToFailingResult.raw_result as any).failedRules
    ).toHaveLength(1);
  });
});
