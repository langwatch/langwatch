import { describe, expect, it } from "vitest";
import type { EvaluationRunData } from "~/server/app-layer/evaluations/types";
import type { PreconditionTraceData } from "../precondition-matchers";
import type { TriggerFilters } from "../types";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesEvaluationFilters,
  matchesTriggerFilters,
} from "../triggerFilter.matcher";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";

function makeTraceData(
  overrides: Partial<PreconditionTraceData> = {},
): PreconditionTraceData {
  return {
    input: "hello",
    output: "world",
    origin: "application",
    hasError: false,
    userId: "user-1",
    threadId: "thread-1",
    customerId: "customer-1",
    labels: ["prod"],
    promptIds: null,
    topicId: null,
    subTopicId: null,
    spanModels: ["gpt-4"],
    customMetadata: { env: "production" },
    annotationIds: [],
    ...overrides,
  };
}

describe("matchesTriggerFilters", () => {
  describe("when filters are empty", () => {
    it("returns true", () => {
      const data = makeTraceData();
      expect(matchesTriggerFilters(data, {})).toBe(true);
    });
  });

  describe("when filtering by traces.origin", () => {
    it("matches when origin is in filter values", () => {
      const data = makeTraceData({ origin: "application" });
      const filters: TriggerFilters = {
        "traces.origin": ["application", "playground"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when origin is not in filter values", () => {
      const data = makeTraceData({ origin: "playground" });
      const filters: TriggerFilters = { "traces.origin": ["application"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by traces.error", () => {
    it("matches error traces", () => {
      const data = makeTraceData({ hasError: true });
      const filters: TriggerFilters = { "traces.error": ["true"] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match non-error traces", () => {
      const data = makeTraceData({ hasError: false });
      const filters: TriggerFilters = { "traces.error": ["true"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by spans.model", () => {
    it("matches when any model is in filter values", () => {
      const data = makeTraceData({ spanModels: ["gpt-4", "gpt-5-mini"] });
      const filters: TriggerFilters = { "spans.model": ["gpt-5-mini"] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when no model matches", () => {
      const data = makeTraceData({ spanModels: ["gpt-4"] });
      const filters: TriggerFilters = { "spans.model": ["claude-3"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });

    it("does not match when spanModels is null", () => {
      const data = makeTraceData({ spanModels: null });
      const filters: TriggerFilters = { "spans.model": ["gpt-4"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by metadata.user_id", () => {
    it("matches when userId is in filter values", () => {
      const data = makeTraceData({ userId: "alice" });
      const filters: TriggerFilters = {
        "metadata.user_id": ["alice", "bob"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when userId is not in filter values", () => {
      const data = makeTraceData({ userId: "charlie" });
      const filters: TriggerFilters = {
        "metadata.user_id": ["alice", "bob"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by metadata.labels", () => {
    it("matches when any label is in filter values", () => {
      const data = makeTraceData({ labels: ["prod", "v2"] });
      const filters: TriggerFilters = { "metadata.labels": ["v2"] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when no labels overlap", () => {
      const data = makeTraceData({ labels: ["staging"] });
      const filters: TriggerFilters = { "metadata.labels": ["prod"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by metadata.value (keyed)", () => {
    it("matches keyed metadata value", () => {
      const data = makeTraceData({ customMetadata: { env: "production" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when key exists but value differs", () => {
      const data = makeTraceData({ customMetadata: { env: "staging" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });

    it("uses OR semantics across multiple keys (matches if any key matches)", () => {
      const data = makeTraceData({ customMetadata: { env: "staging", region: "eu" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"], region: ["eu"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when no keys match (OR of all false)", () => {
      const data = makeTraceData({ customMetadata: { env: "staging", region: "us" } });
      const filters: TriggerFilters = {
        "metadata.value": { env: ["production"], region: ["eu"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filtering by topics.topics", () => {
    it("matches when topicId is in filter values", () => {
      const data = makeTraceData({ topicId: "topic-1" });
      const filters: TriggerFilters = {
        "topics.topics": ["topic-1", "topic-2"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when topicId is null", () => {
      const data = makeTraceData({ topicId: null });
      const filters: TriggerFilters = { "topics.topics": ["topic-1"] };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when combining multiple filters (AND semantics)", () => {
    it("matches when all filters pass", () => {
      const data = makeTraceData({
        origin: "application",
        hasError: true,
        spanModels: ["gpt-4"],
      });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "traces.error": ["true"],
        "spans.model": ["gpt-4"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("does not match when one filter fails", () => {
      const data = makeTraceData({
        origin: "application",
        hasError: false,
        spanModels: ["gpt-4"],
      });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "traces.error": ["true"],
        "spans.model": ["gpt-4"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filters contain evaluation fields", () => {
    it("returns false", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-1": ["true"] },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(false);
    });
  });

  describe("when filter values are empty arrays", () => {
    it("treats empty array as pass-through", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = { "traces.origin": [] };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });
  });

  describe("when filters contain unsupported fields", () => {
    it("skips metadata.key (key-selector) without failing", () => {
      const data = makeTraceData({ origin: "application" });
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "metadata.key": ["some_key"],
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });

    it("skips events.metrics.value (numeric-only) without failing", () => {
      const data = makeTraceData();
      const filters: TriggerFilters = {
        "events.metrics.value": { click: { count: ["5"] } },
      };
      expect(matchesTriggerFilters(data, filters)).toBe(true);
    });
  });
});

describe("classifyTriggerFilters", () => {
  it("separates trace and evaluation filters", () => {
    const filters: TriggerFilters = {
      "traces.origin": ["application"],
      "spans.model": ["gpt-4"],
      "evaluations.passed": { "eval-1": ["true"] },
      "evaluations.score": { "eval-1": { score: ["0.5"] } },
    };

    const result = classifyTriggerFilters(filters);

    expect(Object.keys(result.traceFilters)).toEqual([
      "traces.origin",
      "spans.model",
    ]);
    expect(Object.keys(result.evaluationFilters)).toEqual([
      "evaluations.passed",
      "evaluations.score",
    ]);
    expect(result.hasEvaluationFilters).toBe(true);
  });

  it("reports no evaluation filters when absent", () => {
    const filters: TriggerFilters = {
      "traces.origin": ["application"],
    };

    const result = classifyTriggerFilters(filters);
    expect(result.hasEvaluationFilters).toBe(false);
  });
});

describe("matchesEvaluationFilters", () => {
  function makeEval(
    overrides: Partial<EvaluationRunData> = {},
  ): EvaluationRunData {
    return {
      evaluationId: "eval-1",
      evaluatorId: "evaluator-1",
      evaluatorType: "custom",
      evaluatorName: "Test Evaluator",
      traceId: "trace-1",
      isGuardrail: false,
      status: "processed",
      score: null,
      passed: null,
      label: null,
      details: null,
      inputs: null,
      error: null,
      errorDetails: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
      archivedAt: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: Date.now(),
      costId: null,
      ...overrides,
    };
  }

  describe("when filters are empty", () => {
    it("returns true", () => {
      expect(matchesEvaluationFilters([makeEval()], {})).toBe(true);
    });
  });

  describe("when filtering by evaluations.evaluator_id", () => {
    it("matches when evaluatorId is in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id": ["eval-abc", "eval-def"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when evaluatorId is not in filter values", () => {
      const evals = [makeEval({ evaluatorId: "eval-xyz" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.guardrails_only", () => {
    it("matches guardrail evaluator", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", isGuardrail: true }),
      ];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.guardrails_only": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match non-guardrail evaluator", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", isGuardrail: false }),
      ];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.guardrails_only": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_passed", () => {
    it("matches when evaluator has passed result", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: true }),
      ];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when passed is null", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: null }),
      ];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_passed": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_score", () => {
    it("matches when evaluator has score", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when score is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_score": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.evaluator_id.has_label", () => {
    it("matches when evaluator has label", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", label: "positive" }),
      ];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when label is null", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: null })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });

    it("does not match when label is empty", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", label: "" })];
      const filters: TriggerFilters = {
        "evaluations.evaluator_id.has_label": ["eval-abc"],
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.passed (keyed)", () => {
    it("matches when evaluator passed", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: true }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("matches when evaluator failed", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: false }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["false"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when passed value differs", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: false }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });

    it("does not match when evaluator not found", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-xyz", passed: true }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.score (double-keyed)", () => {
    it("matches when score equals filter value", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.85 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when score differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", score: 0.5 })];
      const filters: TriggerFilters = {
        "evaluations.score": { "eval-abc": { score: ["0.85"] } },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.state (keyed)", () => {
    it("matches when status matches", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "processed" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when status differs", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", status: "error" })];
      const filters: TriggerFilters = {
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering by evaluations.label (keyed)", () => {
    it("matches when label is in filter values", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", label: "positive" }),
      ];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive", "negative"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when label is not in filter values", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", label: "neutral" }),
      ];
      const filters: TriggerFilters = {
        "evaluations.label": { "eval-abc": ["positive", "negative"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when combining multiple evaluation filters (AND semantics)", () => {
    it("matches when all evaluation filters pass", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          passed: true,
          status: "processed",
          label: "good",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
        "evaluations.state": { "eval-abc": ["processed"] },
        "evaluations.label": { "eval-abc": ["good"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when one evaluation filter fails", () => {
      const evals = [
        makeEval({
          evaluatorId: "eval-abc",
          passed: true,
          status: "error",
          label: "good",
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": { "eval-abc": ["true"] },
        "evaluations.state": { "eval-abc": ["processed"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when filtering across multiple evaluators", () => {
    it("matches when each evaluator satisfies its respective filter", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: true }),
        makeEval({
          evaluationId: "eval-2",
          evaluatorId: "eval-def",
          passed: false,
        }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": {
          "eval-abc": ["true"],
          "eval-def": ["false"],
        },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });

    it("does not match when one evaluator is missing", () => {
      const evals = [
        makeEval({ evaluatorId: "eval-abc", passed: true }),
      ];
      const filters: TriggerFilters = {
        "evaluations.passed": {
          "eval-abc": ["true"],
          "eval-def": ["true"],
        },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(false);
    });
  });

  describe("when non-evaluation fields are present", () => {
    it("ignores trace-level filters", () => {
      const evals = [makeEval({ evaluatorId: "eval-abc", passed: true })];
      const filters: TriggerFilters = {
        "traces.origin": ["application"],
        "evaluations.passed": { "eval-abc": ["true"] },
      };
      expect(matchesEvaluationFilters(evals, filters)).toBe(true);
    });
  });
});

describe("buildPreconditionTraceDataFromFoldState", () => {
  it("extracts custom metadata from langwatch.metadata.* legacy keys", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      topicId: null,
      subTopicId: null,
      annotationIds: [],
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      attributes: {
        "langwatch.origin": "application",
        "langwatch.metadata.env": "production",
        "langwatch.metadata.region": "eu-west-1",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = buildPreconditionTraceDataFromFoldState(foldState);

    expect(result.customMetadata).toEqual({
      env: "production",
      region: "eu-west-1",
    });
  });

  it("extracts custom metadata from bare OTEL resource attributes", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      topicId: null,
      subTopicId: null,
      annotationIds: [],
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      attributes: {
        "langwatch.origin": "application",
        env: "staging",
        region: "us-east-1",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = buildPreconditionTraceDataFromFoldState(foldState);

    expect(result.customMetadata).toEqual({
      env: "staging",
      region: "us-east-1",
    });
  });

  it("prefers canonical metadata.* over langwatch.metadata.* and bare keys", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      topicId: null,
      subTopicId: null,
      annotationIds: [],
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      attributes: {
        "langwatch.origin": "application",
        env: "bare-value",
        "langwatch.metadata.env": "legacy-value",
        "metadata.env": "canonical-value",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = buildPreconditionTraceDataFromFoldState(foldState);

    expect(result.customMetadata).toEqual({ env: "canonical-value" });
  });

  it("excludes standard OTEL bare-key prefixes from custom metadata", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      topicId: null,
      subTopicId: null,
      annotationIds: [],
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      attributes: {
        "langwatch.origin": "application",
        "service.name": "my-app",
        "http.method": "GET",
        "telemetry.sdk.name": "opentelemetry",
        custom_field: "included",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = buildPreconditionTraceDataFromFoldState(foldState);

    expect(result.customMetadata).toEqual({ custom_field: "included" });
  });

  it("extracts fields from fold state attributes", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 3,
      totalDurationMs: 1000,
      computedIOSchemaVersion: "1",
      computedInput: "hello world",
      computedOutput: "goodbye world",
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: true,
      containsOKStatus: false,
      errorMessage: "boom",
      models: ["gpt-4", "gpt-5-mini"],
      totalCost: 0.01,
      tokensEstimated: false,
      totalPromptTokenCount: 100,
      totalCompletionTokenCount: 50,
      outputFromRootSpan: true,
      outputSpanEndTimeMs: 1000,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      topicId: "topic-1",
      subTopicId: "subtopic-1",
      annotationIds: ["ann-1"],
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      attributes: {
        "langwatch.origin": "application",
        "langwatch.user_id": "user-42",
        "gen_ai.conversation.id": "thread-7",
        "langwatch.customer_id": "cust-99",
        "langwatch.labels": '["prod","v2"]',
        "langwatch.prompt_ids": '["prompt-1"]',
        "metadata.custom_field": "custom_value",
      },
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = buildPreconditionTraceDataFromFoldState(foldState);

    expect(result.input).toBe("hello world");
    expect(result.output).toBe("goodbye world");
    expect(result.origin).toBe("application");
    expect(result.hasError).toBe(true);
    expect(result.userId).toBe("user-42");
    expect(result.threadId).toBe("thread-7");
    expect(result.customerId).toBe("cust-99");
    expect(result.labels).toEqual(["prod", "v2"]);
    expect(result.promptIds).toEqual(["prompt-1"]);
    expect(result.topicId).toBe("topic-1");
    expect(result.subTopicId).toBe("subtopic-1");
    expect(result.spanModels).toEqual(["gpt-4", "gpt-5-mini"]);
    expect(result.customMetadata).toEqual({ custom_field: "custom_value" });
    expect(result.annotationIds).toEqual(["ann-1"]);
  });

  it("extracts events from hoisted fold state events", () => {
    const foldState = {
      traceId: "trace-1",
      traceName: "",
      spanCount: 1,
      totalDurationMs: 100,
      computedIOSchemaVersion: "1",
      computedInput: null,
      computedOutput: null,
      timeToFirstTokenMs: null,
      timeToLastTokenMs: null,
      tokensPerSecond: null,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      models: [],
      totalCost: null,
      tokensEstimated: false,
      totalPromptTokenCount: null,
      totalCompletionTokenCount: null,
      outputFromRootSpan: false,
      outputSpanEndTimeMs: 0,
      blockedByGuardrail: false,
      rootSpanType: null,
      containsAi: false,
      topicId: null,
      subTopicId: null,
      annotationIds: [],
      containsPrompt: false,
      selectedPromptId: null,
      selectedPromptSpanId: null,
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: null,
      lastUsedPromptVersionNumber: null,
      lastUsedPromptVersionId: null,
      lastUsedPromptSpanId: null,
      lastUsedPromptStartTimeMs: null,
      attributes: { "langwatch.origin": "application" },
      events: [
        {
          spanId: "span-1",
          timestamp: Date.now(),
          name: "thumbs_up_down",
          attributes: {
            "event.type": "thumbs_up_down",
            "event.metrics.score": "1",
            "event.details.page": "/chat",
          },
        },
      ],
      occurredAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      LastEventOccurredAt: Date.now(),
    } as TraceSummaryData;

    const result = buildPreconditionTraceDataFromFoldState(foldState);

    expect(result.events).toHaveLength(1);
    expect(result.events![0]!.event_type).toBe("thumbs_up_down");
    expect(result.events![0]!.metrics).toEqual([{ key: "score", value: 1 }]);
    expect(result.events![0]!.event_details).toEqual([
      { key: "page", value: "/chat" },
    ]);
  });
});
