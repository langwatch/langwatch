import { describe, expect, it } from "vitest";
import {
  evaluatePreconditions,
  type PreconditionTrace,
} from "../preconditions";
import {
  PRECONDITION_FIELD_CONFIG,
  type CheckPreconditionFields,
} from "../types";
import type { Span, LLMSpan, BaseSpan } from "../../tracer/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrace(overrides: Partial<PreconditionTrace> = {}): PreconditionTrace {
  return {
    input: { value: "" },
    output: { value: "" },
    metadata: {
      labels: [],
      thread_id: undefined,
      user_id: undefined,
      customer_id: undefined,
      prompt_ids: undefined,
    },
    expected_output: undefined,
    origin: undefined,
    error: null,
    ...overrides,
  };
}

function makeLLMSpan(overrides: Partial<LLMSpan> = {}): LLMSpan {
  return {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "llm",
    timestamps: { started_at: 0, finished_at: 0 },
    ...overrides,
  };
}

function makeBaseSpan(overrides: Partial<BaseSpan> = {}): BaseSpan {
  return {
    span_id: "span-1",
    trace_id: "trace-1",
    type: "span",
    timestamps: { started_at: 0, finished_at: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Field Configuration Registry
// ---------------------------------------------------------------------------

describe("PRECONDITION_FIELD_CONFIG", () => {
  describe("when listing all fields", () => {
    it("defines exactly 11 fields", () => {
      const fields = Object.keys(PRECONDITION_FIELD_CONFIG);
      expect(fields).toHaveLength(11);
    });

    it("includes all trace-time filter fields", () => {
      const expectedFields: CheckPreconditionFields[] = [
        "input",
        "output",
        "traces.origin",
        "traces.error",
        "metadata.labels",
        "metadata.user_id",
        "metadata.thread_id",
        "metadata.customer_id",
        "metadata.prompt_ids",
        "spans.type",
        "spans.model",
      ];
      for (const field of expectedFields) {
        expect(PRECONDITION_FIELD_CONFIG).toHaveProperty(field);
      }
    });
  });

  describe("when checking field categories", () => {
    it("assigns Trace category to input, output, traces.origin, traces.error", () => {
      expect(PRECONDITION_FIELD_CONFIG["input"].category).toBe("Trace");
      expect(PRECONDITION_FIELD_CONFIG["output"].category).toBe("Trace");
      expect(PRECONDITION_FIELD_CONFIG["traces.origin"].category).toBe("Trace");
      expect(PRECONDITION_FIELD_CONFIG["traces.error"].category).toBe("Trace");
    });

    it("assigns Metadata category to metadata fields", () => {
      expect(PRECONDITION_FIELD_CONFIG["metadata.labels"].category).toBe("Metadata");
      expect(PRECONDITION_FIELD_CONFIG["metadata.user_id"].category).toBe("Metadata");
      expect(PRECONDITION_FIELD_CONFIG["metadata.thread_id"].category).toBe("Metadata");
      expect(PRECONDITION_FIELD_CONFIG["metadata.customer_id"].category).toBe("Metadata");
      expect(PRECONDITION_FIELD_CONFIG["metadata.prompt_ids"].category).toBe("Metadata");
    });

    it("assigns Spans category to span fields", () => {
      expect(PRECONDITION_FIELD_CONFIG["spans.type"].category).toBe("Spans");
      expect(PRECONDITION_FIELD_CONFIG["spans.model"].category).toBe("Spans");
    });
  });

  describe("when checking allowed rules per field type", () => {
    it("allows all 4 rules for text fields (input, output)", () => {
      const expectedRules = ["contains", "not_contains", "matches_regex", "is"];
      expect(PRECONDITION_FIELD_CONFIG["input"].allowedRules).toEqual(expect.arrayContaining(expectedRules));
      expect(PRECONDITION_FIELD_CONFIG["output"].allowedRules).toEqual(expect.arrayContaining(expectedRules));
    });

    it("allows only 'is' for enum fields (traces.origin)", () => {
      expect(PRECONDITION_FIELD_CONFIG["traces.origin"].allowedRules).toEqual(["is"]);
    });

    it("allows only 'is' for boolean fields (traces.error)", () => {
      expect(PRECONDITION_FIELD_CONFIG["traces.error"].allowedRules).toEqual(["is"]);
    });

    it("allows all 4 rules for string metadata fields", () => {
      const expectedRules = ["contains", "not_contains", "matches_regex", "is"];
      expect(PRECONDITION_FIELD_CONFIG["metadata.user_id"].allowedRules).toEqual(expect.arrayContaining(expectedRules));
      expect(PRECONDITION_FIELD_CONFIG["metadata.thread_id"].allowedRules).toEqual(expect.arrayContaining(expectedRules));
      expect(PRECONDITION_FIELD_CONFIG["metadata.customer_id"].allowedRules).toEqual(expect.arrayContaining(expectedRules));
    });

    it("allows only 'is' for span lookup fields", () => {
      expect(PRECONDITION_FIELD_CONFIG["spans.model"].allowedRules).toEqual(["is"]);
      expect(PRECONDITION_FIELD_CONFIG["spans.type"].allowedRules).toEqual(["is"]);
    });

    it("allows is, contains, not_contains for array fields", () => {
      const expectedRules = ["is", "contains", "not_contains"];
      expect(PRECONDITION_FIELD_CONFIG["metadata.labels"].allowedRules).toEqual(expect.arrayContaining(expectedRules));
      expect(PRECONDITION_FIELD_CONFIG["metadata.prompt_ids"].allowedRules).toEqual(expect.arrayContaining(expectedRules));
    });
  });
});

// ---------------------------------------------------------------------------
// evaluatePreconditions()
// ---------------------------------------------------------------------------

describe("evaluatePreconditions()", () => {
  // ── Origin "is" application ──
  describe("given a precondition: traces.origin is 'application'", () => {
    const preconditions = [
      { field: "traces.origin" as const, rule: "is" as const, value: "application" },
    ];

    describe("when a trace arrives with no origin attribute", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({ origin: undefined });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with origin = ''", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({ origin: "" });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with origin = 'evaluation'", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({ origin: "evaluation" });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── Origin "is" non-application ──
  describe("given a precondition: traces.origin is 'simulation'", () => {
    const preconditions = [
      { field: "traces.origin" as const, rule: "is" as const, value: "simulation" },
    ];

    describe("when a trace arrives with origin = 'simulation'", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({ origin: "simulation" });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with no origin attribute", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({ origin: undefined });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });

    describe("when a trace arrives with origin = 'playground'", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({ origin: "playground" });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── "is" on text fields (case-insensitive exact match) ──
  describe("given a precondition: input is 'Hello World'", () => {
    const preconditions = [
      { field: "input" as const, rule: "is" as const, value: "Hello World" },
    ];

    describe("when a trace arrives with input 'hello world'", () => {
      it("passes the precondition (case-insensitive)", () => {
        const trace = makeTrace({ input: { value: "hello world" } });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with input 'Hello World!'", () => {
      it("fails the precondition (not exact match)", () => {
        const trace = makeTrace({ input: { value: "Hello World!" } });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── "is" on array fields ──
  describe("given a precondition: metadata.labels is 'production'", () => {
    const preconditions = [
      { field: "metadata.labels" as const, rule: "is" as const, value: "production" },
    ];

    describe("when a trace arrives with labels ['production', 'api']", () => {
      it("passes the precondition (value in array)", () => {
        const trace = makeTrace({
          metadata: { labels: ["production", "api"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with labels ['staging']", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({
          metadata: { labels: ["staging"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── "is" on metadata.prompt_ids ──
  describe("given a precondition: metadata.prompt_ids is 'prompt_1'", () => {
    const preconditions = [
      { field: "metadata.prompt_ids" as const, rule: "is" as const, value: "prompt_1" },
    ];

    describe("when a trace arrives with prompt_ids ['prompt_1', 'prompt_2']", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({
          metadata: { prompt_ids: ["prompt_1", "prompt_2"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with prompt_ids ['prompt_3']", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({
          metadata: { prompt_ids: ["prompt_3"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── "is" on spans.model (ANY semantics) ──
  describe("given a precondition: spans.model is 'gpt-4'", () => {
    const preconditions = [
      { field: "spans.model" as const, rule: "is" as const, value: "gpt-4" },
    ];

    describe("when a trace arrives with spans [llm(model='gpt-4'), llm(model='gpt-3.5')]", () => {
      it("passes the precondition", () => {
        const trace = makeTrace();
        const spans: Span[] = [
          makeLLMSpan({ model: "gpt-4" }),
          makeLLMSpan({ span_id: "span-2", model: "gpt-3.5" }),
        ];
        expect(evaluatePreconditions("custom", trace, spans, preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with spans [llm(model='claude-3')]", () => {
      it("fails the precondition", () => {
        const trace = makeTrace();
        const spans: Span[] = [
          makeLLMSpan({ model: "claude-3" }),
        ];
        expect(evaluatePreconditions("custom", trace, spans, preconditions)).toBe(false);
      });
    });

    describe("when a trace arrives with spans [tool(no model), llm(model='gpt-4')]", () => {
      it("passes the precondition (ANY semantics)", () => {
        const trace = makeTrace();
        const spans: Span[] = [
          makeBaseSpan({ type: "tool" }),
          makeLLMSpan({ span_id: "span-2", model: "gpt-4" }),
        ];
        expect(evaluatePreconditions("custom", trace, spans, preconditions)).toBe(true);
      });
    });
  });

  // ── "is" on spans.type (ANY semantics) ──
  describe("given a precondition: spans.type is 'rag'", () => {
    const preconditions = [
      { field: "spans.type" as const, rule: "is" as const, value: "rag" },
    ];

    describe("when a trace arrives with spans of types ['llm', 'rag']", () => {
      it("passes the precondition", () => {
        const trace = makeTrace();
        const spans: Span[] = [
          makeLLMSpan({ type: "llm" }),
          makeBaseSpan({ span_id: "span-2", type: "rag" }),
        ];
        expect(evaluatePreconditions("custom", trace, spans, preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with spans of types ['llm', 'tool']", () => {
      it("fails the precondition", () => {
        const trace = makeTrace();
        const spans: Span[] = [
          makeLLMSpan({ type: "llm" }),
          makeBaseSpan({ span_id: "span-2", type: "tool" }),
        ];
        expect(evaluatePreconditions("custom", trace, spans, preconditions)).toBe(false);
      });
    });
  });

  // ── traces.error "is" ──
  describe("given a precondition: traces.error is 'true'", () => {
    const preconditions = [
      { field: "traces.error" as const, rule: "is" as const, value: "true" },
    ];

    describe("when a trace arrives with error { has_error: true, message: 'fail' }", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({
          error: { has_error: true, message: "fail", stacktrace: [] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with error null", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({ error: null });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  describe("given a precondition: traces.error is 'false'", () => {
    const preconditions = [
      { field: "traces.error" as const, rule: "is" as const, value: "false" },
    ];

    describe("when a trace arrives with error null", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({ error: null });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with error { has_error: true, message: 'fail' }", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({
          error: { has_error: true, message: "fail", stacktrace: [] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── Metadata string fields ──
  describe("given a precondition: metadata.user_id contains 'admin'", () => {
    const preconditions = [
      { field: "metadata.user_id" as const, rule: "contains" as const, value: "admin" },
    ];

    describe("when a trace arrives with user_id 'admin_123'", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({
          metadata: { user_id: "admin_123" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with user_id 'guest_456'", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({
          metadata: { user_id: "guest_456" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.user_id is 'user_42'", () => {
    const preconditions = [
      { field: "metadata.user_id" as const, rule: "is" as const, value: "user_42" },
    ];

    describe("when a trace arrives with user_id 'user_42'", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({
          metadata: { user_id: "user_42" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with user_id 'user_421'", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({
          metadata: { user_id: "user_421" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.thread_id is 'thread_abc'", () => {
    const preconditions = [
      { field: "metadata.thread_id" as const, rule: "is" as const, value: "thread_abc" },
    ];

    describe("when a trace arrives with thread_id 'thread_abc'", () => {
      it("passes", () => {
        const trace = makeTrace({
          metadata: { thread_id: "thread_abc" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with thread_id 'thread_xyz'", () => {
      it("fails", () => {
        const trace = makeTrace({
          metadata: { thread_id: "thread_xyz" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.customer_id is 'cust_99'", () => {
    const preconditions = [
      { field: "metadata.customer_id" as const, rule: "is" as const, value: "cust_99" },
    ];

    describe("when a trace arrives with customer_id 'cust_99'", () => {
      it("passes", () => {
        const trace = makeTrace({
          metadata: { customer_id: "cust_99" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with customer_id 'cust_100'", () => {
      it("fails", () => {
        const trace = makeTrace({
          metadata: { customer_id: "cust_100" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.customer_id not_contains 'test'", () => {
    const preconditions = [
      { field: "metadata.customer_id" as const, rule: "not_contains" as const, value: "test" },
    ];

    describe("when a trace arrives with customer_id 'test_user'", () => {
      it("fails", () => {
        const trace = makeTrace({
          metadata: { customer_id: "test_user" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });

    describe("when a trace arrives with customer_id 'prod_user'", () => {
      it("passes", () => {
        const trace = makeTrace({
          metadata: { customer_id: "prod_user" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });
  });

  describe("given a precondition: metadata.user_id matches_regex '^admin_\\d+'", () => {
    const preconditions = [
      { field: "metadata.user_id" as const, rule: "matches_regex" as const, value: "^admin_\\d+" },
    ];

    describe("when a trace arrives with user_id 'admin_42'", () => {
      it("passes", () => {
        const trace = makeTrace({
          metadata: { user_id: "admin_42" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with user_id 'user_admin_42'", () => {
      it("fails", () => {
        const trace = makeTrace({
          metadata: { user_id: "user_admin_42" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── Multiple preconditions (AND logic) ──
  describe("given preconditions: traces.origin is 'application' AND input contains 'help'", () => {
    const preconditions = [
      { field: "traces.origin" as const, rule: "is" as const, value: "application" },
      { field: "input" as const, rule: "contains" as const, value: "help" },
    ];

    describe("when a trace arrives with no origin and input 'I need help'", () => {
      it("runs the evaluation", () => {
        const trace = makeTrace({
          origin: undefined,
          input: { value: "I need help" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with origin 'simulation' and input 'I need help'", () => {
      it("skips the evaluation", () => {
        const trace = makeTrace({
          origin: "simulation",
          input: { value: "I need help" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });

    describe("when a trace arrives with no origin and input 'goodbye'", () => {
      it("skips the evaluation", () => {
        const trace = makeTrace({
          origin: undefined,
          input: { value: "goodbye" },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── Missing/null field values ──
  describe("given a precondition: metadata.user_id is 'admin'", () => {
    const preconditions = [
      { field: "metadata.user_id" as const, rule: "is" as const, value: "admin" },
    ];

    describe("when a trace arrives with no user_id set", () => {
      it("fails the precondition", () => {
        const trace = makeTrace({
          metadata: { user_id: undefined },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.user_id not_contains 'admin'", () => {
    const preconditions = [
      { field: "metadata.user_id" as const, rule: "not_contains" as const, value: "admin" },
    ];

    describe("when a trace arrives with no user_id set", () => {
      it("passes the precondition", () => {
        const trace = makeTrace({
          metadata: { user_id: undefined },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });
  });

  // ── Backward compatibility ──
  describe("given legacy preconditions with old fields", () => {
    const preconditions = [
      { field: "input" as const, rule: "contains" as const, value: "customer" },
      { field: "output" as const, rule: "not_contains" as const, value: "error" },
      { field: "metadata.labels" as const, rule: "contains" as const, value: "production" },
    ];

    describe("when traces arrive matching the legacy rules", () => {
      it("evaluates identically to the old behavior", () => {
        const trace = makeTrace({
          input: { value: "customer query" },
          output: { value: "response OK" },
          metadata: { labels: ["production", "api"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });

      it("fails when input does not contain keyword", () => {
        const trace = makeTrace({
          input: { value: "hello" },
          output: { value: "response OK" },
          metadata: { labels: ["production"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });

      it("fails when output contains forbidden word", () => {
        const trace = makeTrace({
          input: { value: "customer query" },
          output: { value: "error occurred" },
          metadata: { labels: ["production"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── "contains" on array fields (substring in any element) ──
  describe("given a precondition: metadata.labels contains 'prod'", () => {
    const preconditions = [
      { field: "metadata.labels" as const, rule: "contains" as const, value: "prod" },
    ];

    describe("when a trace arrives with labels ['production', 'api']", () => {
      it("passes (substring match in element)", () => {
        const trace = makeTrace({
          metadata: { labels: ["production", "api"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });

    describe("when a trace arrives with labels ['staging']", () => {
      it("fails", () => {
        const trace = makeTrace({
          metadata: { labels: ["staging"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  // ── "not_contains" on array fields ──
  describe("given a precondition: metadata.labels not_contains 'test'", () => {
    const preconditions = [
      { field: "metadata.labels" as const, rule: "not_contains" as const, value: "test" },
    ];

    describe("when a trace arrives with labels ['testing', 'qa']", () => {
      it("fails (substring match in element)", () => {
        const trace = makeTrace({
          metadata: { labels: ["testing", "qa"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });

    describe("when a trace arrives with labels ['production']", () => {
      it("passes", () => {
        const trace = makeTrace({
          metadata: { labels: ["production"] },
        });
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });
  });

  // ── Missing array fields ──
  describe("given a precondition: metadata.labels is 'production'", () => {
    describe("when a trace arrives with no labels (null)", () => {
      it("fails", () => {
        const trace = makeTrace({
          metadata: { labels: null },
        });
        const preconditions = [
          { field: "metadata.labels" as const, rule: "is" as const, value: "production" },
        ];
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.labels not_contains 'test'", () => {
    describe("when a trace arrives with no labels (null)", () => {
      it("passes", () => {
        const trace = makeTrace({
          metadata: { labels: null },
        });
        const preconditions = [
          { field: "metadata.labels" as const, rule: "not_contains" as const, value: "test" },
        ];
        expect(evaluatePreconditions("custom", trace, [], preconditions)).toBe(true);
      });
    });
  });

  // ── Empty preconditions array ──
  describe("given no preconditions", () => {
    describe("when a trace arrives", () => {
      it("passes (vacuously true)", () => {
        const trace = makeTrace();
        expect(evaluatePreconditions("custom", trace, [], [])).toBe(true);
      });
    });
  });
});
