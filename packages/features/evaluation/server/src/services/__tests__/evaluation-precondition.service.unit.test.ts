/**
 * @vitest-environment node
 *
 * The precondition rules as the EXECUTION path applies them.
 *
 * This service had no test of its own. The 93 cases under
 * `platform/app/src/server/evaluations/__tests__/preconditions.unit.test.ts`
 * cover a different implementation of the same rules — the one the monitor
 * sample preview uses — and the two do not know the same fields.
 */
import type { ExecuteEvaluationCommandData } from "@langwatch/evaluation-contract";
import type { EvaluationTraceSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import {
  EvaluationPreconditionService,
  PRECONDITION_FIELDS,
} from "../evaluation-precondition.service";

const service = EvaluationPreconditionService.create();

function commandData(overrides: Partial<ExecuteEvaluationCommandData> = {}) {
  return {
    computedInput: "hello world",
    computedOutput: "goodbye",
    origin: "application",
    hasError: false,
    userId: "user_1",
    labels: ["alpha", "beta"],
    customMetadata: { tier: "gold" },
    ...overrides,
  } as ExecuteEvaluationCommandData;
}

function met(precondition: Record<string, unknown>, data = commandData(), spans: EvaluationTraceSpan[] = []) {
  return service.areMet({ data, preconditions: [precondition], spans, events: null });
}

describe("EvaluationPreconditionService.areMet", () => {
  describe("given preconditions that do not parse", () => {
    it("lets the evaluation run rather than blocking on a malformed rule", () => {
      expect(
        service.areMet({ data: commandData(), preconditions: "nonsense", spans: [], events: null }),
      ).toBe(true);
    });
  });

  describe("given a rule over a field this service knows", () => {
    it("matches `contains` case-insensitively", () => {
      expect(met({ field: "input", rule: "contains", value: "WORLD" })).toBe(true);
      expect(met({ field: "input", rule: "contains", value: "absent" })).toBe(false);
    });

    it("matches `is` on the whole value", () => {
      expect(met({ field: "output", rule: "is", value: "goodbye" })).toBe(true);
      expect(met({ field: "output", rule: "is", value: "good" })).toBe(false);
    });

    it("reads an array field member by member", () => {
      expect(met({ field: "metadata.labels", rule: "contains", value: "alph" })).toBe(true);
      expect(met({ field: "metadata.labels", rule: "is", value: "beta" })).toBe(true);
    });

    it("reads custom metadata through its encoded key", () => {
      expect(met({ field: "metadata.value", rule: "is", value: "gold", key: "tier" })).toBe(true);
      expect(
        met({ field: "metadata.value", rule: "is", value: "gold", key: "langwatch·metadata·tier" }),
      ).toBe(true);
    });

    it("renders the error flag as a string so `is` can name it", () => {
      expect(met({ field: "traces.error", rule: "is", value: "false" })).toBe(true);
      expect(
        met({ field: "traces.error", rule: "is", value: "true" }, commandData({ hasError: true })),
      ).toBe(true);
    });
  });

  describe("given `not_contains`", () => {
    it("holds when the field is absent, unlike every other rule", () => {
      expect(met({ field: "metadata.thread_id", rule: "not_contains", value: "x" })).toBe(true);
      expect(met({ field: "metadata.thread_id", rule: "contains", value: "x" })).toBe(false);
    });
  });

  describe("given a regex rule", () => {
    it("refuses a pattern that is not safe to run", () => {
      expect(met({ field: "input", rule: "matches_regex", value: "^hello" })).toBe(true);
      expect(met({ field: "input", rule: "matches_regex", value: "(a+)+$" })).toBe(false);
    });
  });

  describe("given a field this service does not know", () => {
    /**
     * The divergence, pinned. `evaluations.passed` is one of thirteen fields the
     * monitor sample preview resolves and this path does not, so a monitor
     * configured on it previews as matching and then never fires.
     */
    it("treats it as unmet rather than as absent-but-fine", () => {
      expect(met({ field: "evaluations.passed", rule: "is", value: "true" })).toBe(false);
      expect(met({ field: "traces.name", rule: "contains", value: "anything" })).toBe(false);
    });
  });

  describe("the field vocabulary", () => {
    it("is the seventeen this path can answer", () => {
      expect([...PRECONDITION_FIELDS].sort()).toEqual([
        "events.event_details.key",
        "events.event_type",
        "events.metrics.key",
        "input",
        "metadata.customer_id",
        "metadata.labels",
        "metadata.prompt_ids",
        "metadata.thread_id",
        "metadata.user_id",
        "metadata.value",
        "output",
        "spans.model",
        "spans.type",
        "topics.subtopics",
        "topics.topics",
        "traces.error",
        "traces.origin",
      ]);
    });
  });
});
