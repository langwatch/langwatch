import { describe, expect, it } from "vitest";
import {
  getAvailablePreconditionFields,
  getFieldLabel,
  normalizePreconditionTraceData,
  PRECONDITION_ALLOWED_RULES,
  PRECONDITION_FIELD_MATCHERS,
  type PreconditionField,
  type PreconditionTraceData,
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
    annotationIds: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// PRECONDITION_FIELD_MATCHERS
// ---------------------------------------------------------------------------

describe("PRECONDITION_FIELD_MATCHERS", () => {
  describe("input matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS.input!;

    it("returns the input value from trace data", () => {
      expect(
        matcher({ data: makeTraceData({ input: "hello" }), value: "" }),
      ).toBe("hello");
    });

    it("returns null when input is null", () => {
      expect(
        matcher({ data: makeTraceData({ input: null }), value: "" }),
      ).toBeNull();
    });
  });

  describe("output matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS.output!;

    it("returns the output value from trace data", () => {
      expect(
        matcher({ data: makeTraceData({ output: "world" }), value: "" }),
      ).toBe("world");
    });

    it("returns null when output is null", () => {
      expect(
        matcher({ data: makeTraceData({ output: null }), value: "" }),
      ).toBeNull();
    });
  });

  describe("traces.origin matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["traces.origin"]!;

    it("returns null when origin is undefined", () => {
      expect(
        matcher({ data: makeTraceData({ origin: undefined }), value: "" }),
      ).toBeNull();
    });

    it("returns null when origin is null", () => {
      expect(
        matcher({ data: makeTraceData({ origin: null }), value: "" }),
      ).toBeNull();
    });

    it("returns empty string when origin is empty string", () => {
      expect(matcher({ data: makeTraceData({ origin: "" }), value: "" })).toBe(
        "",
      );
    });

    it("returns 'application' when origin is explicitly 'application'", () => {
      expect(
        matcher({ data: makeTraceData({ origin: "application" }), value: "" }),
      ).toBe("application");
    });

    it("returns the origin value when present", () => {
      expect(
        matcher({ data: makeTraceData({ origin: "playground" }), value: "" }),
      ).toBe("playground");
    });
  });

  describe("traces.error matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["traces.error"]!;

    it("returns 'true' when hasError is true", () => {
      expect(
        matcher({ data: makeTraceData({ hasError: true }), value: "" }),
      ).toBe("true");
    });

    it("returns 'false' when hasError is false", () => {
      expect(
        matcher({ data: makeTraceData({ hasError: false }), value: "" }),
      ).toBe("false");
    });

    it("returns 'false' when hasError is null", () => {
      expect(
        matcher({ data: makeTraceData({ hasError: null }), value: "" }),
      ).toBe("false");
    });
  });

  describe("metadata.user_id matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.user_id"]!;

    it("returns userId from trace data", () => {
      expect(
        matcher({ data: makeTraceData({ userId: "user_1" }), value: "" }),
      ).toBe("user_1");
    });

    it("returns undefined when userId is not set", () => {
      expect(
        matcher({ data: makeTraceData({ userId: undefined }), value: "" }),
      ).toBeUndefined();
    });
  });

  describe("metadata.thread_id matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.thread_id"]!;

    it("returns threadId from trace data", () => {
      expect(
        matcher({ data: makeTraceData({ threadId: "t_1" }), value: "" }),
      ).toBe("t_1");
    });
  });

  describe("metadata.customer_id matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.customer_id"]!;

    it("returns customerId from trace data", () => {
      expect(
        matcher({ data: makeTraceData({ customerId: "cust_1" }), value: "" }),
      ).toBe("cust_1");
    });
  });

  describe("metadata.labels matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.labels"]!;

    it("returns labels array from trace data", () => {
      expect(
        matcher({ data: makeTraceData({ labels: ["a", "b"] }), value: "" }),
      ).toEqual(["a", "b"]);
    });

    it("returns empty array when labels is empty", () => {
      expect(
        matcher({ data: makeTraceData({ labels: [] }), value: "" }),
      ).toEqual([]);
    });
  });

  describe("metadata.prompt_ids matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["metadata.prompt_ids"]!;

    it("returns promptIds array from trace data", () => {
      expect(
        matcher({
          data: makeTraceData({ promptIds: ["p1", "p2"] }),
          value: "",
        }),
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
        expect(matcher({ data, value: "", key: "env" })).toBe("prod");
      });

      it("returns null when key is missing from metadata", () => {
        const data = makeTraceData({
          customMetadata: { env: "prod" },
        });
        expect(matcher({ data, value: "", key: "region" })).toBeNull();
      });
    });

    describe("when key is not provided", () => {
      it("returns null", () => {
        const data = makeTraceData({
          customMetadata: { env: "prod" },
        });
        expect(matcher({ data, value: "" })).toBeNull();
      });
    });

    describe("when customMetadata is null", () => {
      it("returns null", () => {
        const data = makeTraceData({ customMetadata: null });
        expect(matcher({ data, value: "", key: "env" })).toBeNull();
      });
    });
  });

  describe("spans.type matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["spans.type"]!;

    it("returns spanTypes array from trace data", () => {
      expect(
        matcher({
          data: makeTraceData({ spanTypes: ["llm", "rag"] }),
          value: "",
        }),
      ).toEqual(["llm", "rag"]);
    });
  });

  describe("spans.model matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["spans.model"]!;

    it("returns spanModels array from trace data", () => {
      expect(
        matcher({ data: makeTraceData({ spanModels: ["gpt-4"] }), value: "" }),
      ).toEqual(["gpt-4"]);
    });
  });

  describe("topics.topics matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["topics.topics"]!;

    it("returns topicId wrapped in array when present", () => {
      expect(
        matcher({ data: makeTraceData({ topicId: "topic_1" }), value: "" }),
      ).toEqual(["topic_1"]);
    });

    it("returns null when topicId is not set", () => {
      expect(
        matcher({ data: makeTraceData({ topicId: undefined }), value: "" }),
      ).toBeNull();
    });
  });

  describe("topics.subtopics matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["topics.subtopics"]!;

    it("returns subTopicId wrapped in array when present", () => {
      expect(
        matcher({ data: makeTraceData({ subTopicId: "sub_1" }), value: "" }),
      ).toEqual(["sub_1"]);
    });

    it("returns null when subTopicId is not set", () => {
      expect(
        matcher({ data: makeTraceData({ subTopicId: undefined }), value: "" }),
      ).toBeNull();
    });
  });

  describe("annotations.hasAnnotation matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["annotations.hasAnnotation"]!;

    it("returns 'true' when annotationIds is non-empty", () => {
      expect(
        matcher({
          data: makeTraceData({ annotationIds: ["ann-1"] }),
          value: "",
        }),
      ).toBe("true");
    });

    it("returns 'false' when annotationIds is empty", () => {
      expect(
        matcher({ data: makeTraceData({ annotationIds: [] }), value: "" }),
      ).toBe("false");
    });

    it("returns null when annotationIds is undefined", () => {
      expect(
        matcher({
          data: makeTraceData({ annotationIds: undefined }),
          value: "",
        }),
      ).toBeNull();
    });
  });

  describe("events.event_type matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["events.event_type"]!;

    it("returns event types from trace data", () => {
      const data = makeTraceData({
        events: [
          { event_type: "thumbs_up_down", metrics: [], event_details: [] },
          { event_type: "purchase", metrics: [], event_details: [] },
        ],
      });
      expect(matcher({ data, value: "" })).toEqual([
        "thumbs_up_down",
        "purchase",
      ]);
    });

    it("returns null when events is null", () => {
      expect(
        matcher({ data: makeTraceData({ events: null }), value: "" }),
      ).toBeNull();
    });
  });

  describe("events.metrics.key matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["events.metrics.key"]!;

    it("returns metric keys for a specific event type", () => {
      const data = makeTraceData({
        events: [
          {
            event_type: "thumbs_up_down",
            metrics: [{ key: "vote", value: 1 }],
            event_details: [],
          },
        ],
      });
      expect(matcher({ data, value: "", key: "thumbs_up_down" })).toEqual([
        "vote",
      ]);
    });

    it("returns null when key (event_type) is not provided", () => {
      const data = makeTraceData({
        events: [
          {
            event_type: "thumbs_up_down",
            metrics: [{ key: "vote", value: 1 }],
            event_details: [],
          },
        ],
      });
      expect(matcher({ data, value: "" })).toBeNull();
    });

    it("returns null when no matching event type", () => {
      const data = makeTraceData({
        events: [
          {
            event_type: "purchase",
            metrics: [{ key: "amount", value: 99 }],
            event_details: [],
          },
        ],
      });
      expect(matcher({ data, value: "", key: "thumbs_up_down" })).toBeNull();
    });
  });

  describe("events.event_details.key matcher", () => {
    const matcher = PRECONDITION_FIELD_MATCHERS["events.event_details.key"]!;

    it("returns event detail keys for a specific event type", () => {
      const data = makeTraceData({
        events: [
          {
            event_type: "purchase",
            metrics: [],
            event_details: [{ key: "item", value: "shoes" }],
          },
        ],
      });
      expect(matcher({ data, value: "", key: "purchase" })).toEqual(["item"]);
    });

    it("returns null when key (event_type) is not provided", () => {
      const data = makeTraceData({
        events: [
          {
            event_type: "purchase",
            metrics: [],
            event_details: [{ key: "item", value: "shoes" }],
          },
        ],
      });
      expect(matcher({ data, value: "" })).toBeNull();
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
      "events.metrics.value",
      "metadata.key",
    ];

    it("has null matchers for evaluation, numeric event, and key-selector fields", () => {
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
  /** @scenario Allowed rules derive from field characteristics */
  it("allows all 4 text rules for input and output", () => {
    const textRules = ["is", "contains", "not_contains", "matches_regex"];
    expect(PRECONDITION_ALLOWED_RULES.input).toEqual(textRules);
    expect(PRECONDITION_ALLOWED_RULES.output).toEqual(textRules);
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
    expect(PRECONDITION_ALLOWED_RULES["events.event_type"]).toEqual(["is"]);
    expect(PRECONDITION_ALLOWED_RULES["events.metrics.key"]).toEqual(["is"]);
    expect(PRECONDITION_ALLOWED_RULES["events.event_details.key"]).toEqual([
      "is",
    ]);
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
    expect(PRECONDITION_ALLOWED_RULES["metadata.thread_id"]).toEqual(textRules);
    expect(PRECONDITION_ALLOWED_RULES["metadata.customer_id"]).toEqual(
      textRules,
    );
    expect(PRECONDITION_ALLOWED_RULES["metadata.value"]).toEqual(textRules);
  });

  it("has empty rules for non-precondition fields", () => {
    expect(PRECONDITION_ALLOWED_RULES["metadata.key"]).toEqual([]);
    expect(PRECONDITION_ALLOWED_RULES["evaluations.evaluator_id"]).toEqual([]);
    expect(PRECONDITION_ALLOWED_RULES["events.metrics.value"]).toEqual([]);
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

  it("excludes key-selector, evaluation, and numeric event fields", () => {
    const fields = getAvailablePreconditionFields();
    const fieldNames = fields.map((f) => f.field);
    expect(fieldNames).not.toContain("metadata.key");
    expect(fieldNames).not.toContain("evaluations.evaluator_id");
    expect(fieldNames).not.toContain("events.metrics.value");
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
    expect(fieldNames).toContain("events.event_type");
    expect(fieldNames).toContain("events.metrics.key");
    expect(fieldNames).toContain("events.event_details.key");
  });

  it("returns correct labels for each field", () => {
    const fields = getAvailablePreconditionFields();
    const fieldMap = Object.fromEntries(fields.map((f) => [f.field, f.label]));
    expect(fieldMap.input).toBe("Input");
    expect(fieldMap.output).toBe("Output");
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

// ---------------------------------------------------------------------------
// normalizePreconditionTraceData()
// ---------------------------------------------------------------------------

describe("normalizePreconditionTraceData()", () => {
  describe("given trace data with no origin set", () => {
    describe("when origin is undefined", () => {
      it("defaults origin to 'application'", () => {
        const result = normalizePreconditionTraceData(
          makeTraceData({ origin: undefined }),
        );
        expect(result.origin).toBe("application");
      });
    });

    describe("when origin is null", () => {
      it("defaults origin to 'application'", () => {
        const result = normalizePreconditionTraceData(
          makeTraceData({ origin: null }),
        );
        expect(result.origin).toBe("application");
      });
    });
  });

  describe("given trace data with an explicit origin", () => {
    describe("when origin is 'evaluation'", () => {
      it("preserves the origin value", () => {
        const result = normalizePreconditionTraceData(
          makeTraceData({ origin: "evaluation" }),
        );
        expect(result.origin).toBe("evaluation");
      });
    });

    describe("when origin is 'playground'", () => {
      it("preserves the origin value", () => {
        const result = normalizePreconditionTraceData(
          makeTraceData({ origin: "playground" }),
        );
        expect(result.origin).toBe("playground");
      });
    });
  });

  describe("given trace data with other fields set", () => {
    it("leaves all other fields untouched", () => {
      const input = makeTraceData({
        origin: undefined,
        userId: "user_42",
        labels: ["prod"],
        hasError: true,
      });
      const result = normalizePreconditionTraceData(input);
      expect(result.userId).toBe("user_42");
      expect(result.labels).toEqual(["prod"]);
      expect(result.hasError).toBe(true);
    });
  });
});
