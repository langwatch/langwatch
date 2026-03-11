import { describe, expect, it } from "vitest";
import {
  PRECONDITION_FIELD_MATCHERS,
  PRECONDITION_ALLOWED_RULES,
  getAvailablePreconditionFields,
  getFieldLabel,
  type PreconditionTraceData,
  type PreconditionField,
} from "../precondition-matchers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTraceData(
  overrides: Partial<PreconditionTraceData> = {},
): PreconditionTraceData {
  return {
    input: "",
    output: "",
    origin: undefined,
    hasError: false,
    userId: undefined,
    threadId: undefined,
    customerId: undefined,
    labels: [],
    promptIds: undefined,
    topicId: undefined,
    subTopicId: undefined,
    spanTypes: undefined,
    spanModels: undefined,
    customMetadata: undefined,
    satisfactionScore: undefined,
    hasAnnotation: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PRECONDITION_FIELD_MATCHERS
// ---------------------------------------------------------------------------

describe("PRECONDITION_FIELD_MATCHERS", () => {
  describe("input matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["input"]!;

    it("returns the input value from trace data", () => {
      expect(matcher(makeTraceData({ input: "hello" }), "")).toBe("hello");
    });

    it("returns null when input is null", () => {
      expect(matcher(makeTraceData({ input: null }), "")).toBeNull();
    });
  });

  describe("output matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["output"]!;

    it("returns the output value from trace data", () => {
      expect(matcher(makeTraceData({ output: "world" }), "")).toBe("world");
    });

    it("returns null when output is null", () => {
      expect(matcher(makeTraceData({ output: null }), "")).toBeNull();
    });
  });

  describe("traces.origin matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["traces.origin"]!;

    it("returns 'application' when origin is falsy", () => {
      expect(matcher(makeTraceData({ origin: undefined }), "")).toBe(
        "application",
      );
      expect(matcher(makeTraceData({ origin: "" }), "")).toBe("application");
      expect(matcher(makeTraceData({ origin: null }), "")).toBe("application");
    });

    it("returns the origin value when present", () => {
      expect(matcher(makeTraceData({ origin: "playground" }), "")).toBe(
        "playground",
      );
    });
  });

  describe("traces.error matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["traces.error"]!;

    it("returns 'true' when hasError is true", () => {
      expect(matcher(makeTraceData({ hasError: true }), "")).toBe("true");
    });

    it("returns 'false' when hasError is false", () => {
      expect(matcher(makeTraceData({ hasError: false }), "")).toBe("false");
    });

    it("returns 'false' when hasError is null", () => {
      expect(matcher(makeTraceData({ hasError: null }), "")).toBe("false");
    });
  });

  describe("metadata.user_id matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.user_id"]!;

    it("returns userId from trace data", () => {
      expect(matcher(makeTraceData({ userId: "user_1" }), "")).toBe("user_1");
    });

    it("returns undefined when userId is not set", () => {
      expect(
        matcher(makeTraceData({ userId: undefined }), ""),
      ).toBeUndefined();
    });
  });

  describe("metadata.thread_id matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.thread_id"]!;

    it("returns threadId from trace data", () => {
      expect(matcher(makeTraceData({ threadId: "t_1" }), "")).toBe("t_1");
    });
  });

  describe("metadata.customer_id matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.customer_id"]!;

    it("returns customerId from trace data", () => {
      expect(matcher(makeTraceData({ customerId: "cust_1" }), "")).toBe(
        "cust_1",
      );
    });
  });

  describe("metadata.labels matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.labels"]!;

    it("returns labels array from trace data", () => {
      expect(
        matcher(makeTraceData({ labels: ["a", "b"] }), ""),
      ).toEqual(["a", "b"]);
    });

    it("returns empty array when labels is empty", () => {
      expect(matcher(makeTraceData({ labels: [] }), "")).toEqual([]);
    });
  });

  describe("metadata.prompt_ids matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.prompt_ids"]!;

    it("returns promptIds array from trace data", () => {
      expect(
        matcher(makeTraceData({ promptIds: ["p1", "p2"] }), ""),
      ).toEqual(["p1", "p2"]);
    });
  });

  describe("metadata.key matcher", () => {
    it("is null (key-selector, not matchable)", () => {
      expect(PRECONDITION_FIELD_MATCHERS["metadata.key"]).toBeNull();
    });
  });

  describe("metadata.value matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.value"]!;

    describe("when key is provided", () => {
      it("returns the metadata value for that key", () => {
        const data = makeTraceData({
          customMetadata: { env: "prod", region: "us" },
        });
        expect(matcher(data, "", "env")).toBe("prod");
      });

      it("returns null when key is missing from metadata", () => {
        const data = makeTraceData({
          customMetadata: { env: "prod" },
        });
        expect(matcher(data, "", "region")).toBeNull();
      });
    });

    describe("when key is not provided", () => {
      it("returns null", () => {
        const data = makeTraceData({
          customMetadata: { env: "prod" },
        });
        expect(matcher(data, "")).toBeNull();
      });
    });

    describe("when customMetadata is null", () => {
      it("returns null", () => {
        const data = makeTraceData({ customMetadata: null });
        expect(matcher(data, "", "env")).toBeNull();
      });
    });
  });

  describe("spans.type matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["spans.type"]!;

    it("returns spanTypes array from trace data", () => {
      expect(
        matcher(makeTraceData({ spanTypes: ["llm", "rag"] }), ""),
      ).toEqual(["llm", "rag"]);
    });
  });

  describe("spans.model matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["spans.model"]!;

    it("returns spanModels array from trace data", () => {
      expect(
        matcher(makeTraceData({ spanModels: ["gpt-4"] }), ""),
      ).toEqual(["gpt-4"]);
    });
  });

  describe("topics.topics matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["topics.topics"]!;

    it("returns topicId wrapped in array when present", () => {
      expect(
        matcher(makeTraceData({ topicId: "topic_1" }), ""),
      ).toEqual(["topic_1"]);
    });

    it("returns null when topicId is not set", () => {
      expect(
        matcher(makeTraceData({ topicId: undefined }), ""),
      ).toBeNull();
    });
  });

  describe("topics.subtopics matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["topics.subtopics"]!;

    it("returns subTopicId wrapped in array when present", () => {
      expect(
        matcher(makeTraceData({ subTopicId: "sub_1" }), ""),
      ).toEqual(["sub_1"]);
    });

    it("returns null when subTopicId is not set", () => {
      expect(
        matcher(makeTraceData({ subTopicId: undefined }), ""),
      ).toBeNull();
    });
  });

  describe("annotations.hasAnnotation matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["annotations.hasAnnotation"]!;

    it("returns 'true' when hasAnnotation is true", () => {
      expect(matcher(makeTraceData({ hasAnnotation: true }), "")).toBe("true");
    });

    it("returns 'false' when hasAnnotation is false", () => {
      expect(matcher(makeTraceData({ hasAnnotation: false }), "")).toBe(
        "false",
      );
    });

    it("returns null when hasAnnotation is null", () => {
      expect(matcher(makeTraceData({ hasAnnotation: null }), "")).toBeNull();
    });
  });

  describe("non-matchable fields", () => {
    const nonMatchableFields: PreconditionField[] = [
      "evaluations.evaluator_id",
      "evaluations.evaluator_id.guardrails_only",
      "evaluations.passed",
      "evaluations.score",
      "evaluations.state",
      "evaluations.label",
      "events.event_type",
      "events.metrics.key",
      "events.metrics.value",
      "events.event_details.key",
      "metadata.key",
    ];

    it("has null matchers for evaluation, event, and key-selector fields", () => {
      for (const field of nonMatchableFields) {
        expect(PRECONDITION_FIELD_MATCHERS[field]).toBeNull();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// PRECONDITION_ALLOWED_RULES
// ---------------------------------------------------------------------------

describe("PRECONDITION_ALLOWED_RULES", () => {
  it("allows all 4 text rules for input and output", () => {
    const textRules = ["is", "contains", "not_contains", "matches_regex"];
    expect(PRECONDITION_ALLOWED_RULES["input"]).toEqual(textRules);
    expect(PRECONDITION_ALLOWED_RULES["output"]).toEqual(textRules);
  });

  it("allows only 'is' for boolean fields", () => {
    expect(PRECONDITION_ALLOWED_RULES["traces.error"]).toEqual(["is"]);
    expect(PRECONDITION_ALLOWED_RULES["annotations.hasAnnotation"]).toEqual([
      "is",
    ]);
  });

  it("allows only 'is' for enum fields", () => {
    expect(PRECONDITION_ALLOWED_RULES["traces.origin"]).toEqual(["is"]);
    expect(PRECONDITION_ALLOWED_RULES["spans.type"]).toEqual(["is"]);
    expect(PRECONDITION_ALLOWED_RULES["spans.model"]).toEqual(["is"]);
    // sentiment.input_sentiment is excluded from preconditions
  });

  it("allows is, contains, not_contains for array fields", () => {
    const arrayRules = ["is", "contains", "not_contains"];
    expect(PRECONDITION_ALLOWED_RULES["metadata.labels"]).toEqual(arrayRules);
    expect(PRECONDITION_ALLOWED_RULES["metadata.prompt_ids"]).toEqual(
      arrayRules,
    );
    expect(PRECONDITION_ALLOWED_RULES["topics.topics"]).toEqual(arrayRules);
    expect(PRECONDITION_ALLOWED_RULES["topics.subtopics"]).toEqual(arrayRules);
  });

  it("allows all text rules for string metadata fields", () => {
    const textRules = ["is", "contains", "not_contains", "matches_regex"];
    expect(PRECONDITION_ALLOWED_RULES["metadata.user_id"]).toEqual(textRules);
    expect(PRECONDITION_ALLOWED_RULES["metadata.thread_id"]).toEqual(
      textRules,
    );
    expect(PRECONDITION_ALLOWED_RULES["metadata.customer_id"]).toEqual(
      textRules,
    );
    expect(PRECONDITION_ALLOWED_RULES["metadata.value"]).toEqual(textRules);
  });

  it("has empty rules for non-precondition fields", () => {
    expect(PRECONDITION_ALLOWED_RULES["metadata.key"]).toEqual([]);
    expect(PRECONDITION_ALLOWED_RULES["evaluations.evaluator_id"]).toEqual([]);
    expect(PRECONDITION_ALLOWED_RULES["events.event_type"]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getAvailablePreconditionFields()
// ---------------------------------------------------------------------------

describe("getAvailablePreconditionFields()", () => {
  it("returns only fields with non-empty allowed rules", () => {
    const fields = getAvailablePreconditionFields();
    for (const entry of fields) {
      expect(entry.allowedRules.length).toBeGreaterThan(0);
    }
  });

  it("excludes key-selector and evaluation/event fields", () => {
    const fields = getAvailablePreconditionFields();
    const fieldNames = fields.map((f) => f.field);
    expect(fieldNames).not.toContain("metadata.key");
    expect(fieldNames).not.toContain("evaluations.evaluator_id");
    expect(fieldNames).not.toContain("events.event_type");
  });

  it("includes all matchable precondition fields", () => {
    const fields = getAvailablePreconditionFields();
    const fieldNames = fields.map((f) => f.field);
    expect(fieldNames).toContain("input");
    expect(fieldNames).toContain("output");
    expect(fieldNames).toContain("traces.origin");
    expect(fieldNames).toContain("traces.error");
    expect(fieldNames).toContain("metadata.user_id");
    expect(fieldNames).toContain("metadata.labels");
    expect(fieldNames).toContain("metadata.value");
    expect(fieldNames).toContain("spans.type");
    expect(fieldNames).toContain("spans.model");
    expect(fieldNames).toContain("topics.topics");
    expect(fieldNames).toContain("topics.subtopics");
    expect(fieldNames).toContain("annotations.hasAnnotation");
    expect(fieldNames).not.toContain("sentiment.input_sentiment");
  });

  it("returns correct labels for each field", () => {
    const fields = getAvailablePreconditionFields();
    const fieldMap = Object.fromEntries(
      fields.map((f) => [f.field, f.label]),
    );
    expect(fieldMap["input"]).toBe("Input");
    expect(fieldMap["output"]).toBe("Output");
  });

  it("returns allowedRules matching PRECONDITION_ALLOWED_RULES", () => {
    const fields = getAvailablePreconditionFields();
    for (const entry of fields) {
      expect(entry.allowedRules).toEqual(
        PRECONDITION_ALLOWED_RULES[entry.field],
      );
    }
  });
});

// ---------------------------------------------------------------------------
// getFieldLabel()
// ---------------------------------------------------------------------------

describe("getFieldLabel()", () => {
  it("returns 'Input' for 'input' field", () => {
    expect(getFieldLabel("input")).toBe("Input");
  });

  it("returns 'Output' for 'output' field", () => {
    expect(getFieldLabel("output")).toBe("Output");
  });

  it("returns the filter registry name for filter fields", () => {
    // traces.origin should come from availableFilters registry
    const label = getFieldLabel("traces.origin");
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
  });

  it("returns registry name for filter fields like evaluations.evaluator_id", () => {
    // evaluations.evaluator_id has a name in the filter registry
    expect(getFieldLabel("evaluations.evaluator_id")).toBe(
      "Contains Evaluation",
    );
  });
});
