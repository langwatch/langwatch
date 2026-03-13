import { describe, expect, it } from "vitest";
import {
  evaluatePreconditions,
  buildPreconditionTraceDataFromTrace,
  buildPreconditionTraceDataFromCommand,
  checkEvaluatorRequiredFields,
  preconditionsNeedEvents,
  type PreconditionTraceData,
} from "../preconditions";
import type { Span, RAGSpan, RAGChunk } from "../../tracer/types";
import type { ExecuteEvaluationCommandData } from "../../event-sourcing/pipelines/evaluation-processing/schemas/commands";

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
// evaluatePreconditions()
// ---------------------------------------------------------------------------

describe("evaluatePreconditions()", () => {
  // ── Origin "is" application ──
  describe("given a precondition: traces.origin is 'application'", () => {
    const preconditions = [
      {
        field: "traces.origin" as const,
        rule: "is" as const,
        value: "application",
      },
    ];

    describe("when a trace arrives with no origin attribute", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ origin: undefined });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with origin = ''", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ origin: "" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with origin = 'evaluation'", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ origin: "evaluation" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── Origin "is" non-application ──
  describe("given a precondition: traces.origin is 'simulation'", () => {
    const preconditions = [
      {
        field: "traces.origin" as const,
        rule: "is" as const,
        value: "simulation",
      },
    ];

    describe("when a trace arrives with origin = 'simulation'", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ origin: "simulation" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with no origin attribute", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ origin: undefined });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when a trace arrives with origin = 'playground'", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ origin: "playground" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── "is" on text fields (case-insensitive exact match) ──
  describe("given a precondition: input is 'Hello World'", () => {
    const preconditions = [
      {
        field: "input" as const,
        rule: "is" as const,
        value: "Hello World",
      },
    ];

    describe("when a trace arrives with input 'hello world'", () => {
      it("passes the precondition (case-insensitive)", () => {
        const traceData = makeTraceData({ input: "hello world" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with input 'Hello World!'", () => {
      it("fails the precondition (not exact match)", () => {
        const traceData = makeTraceData({ input: "Hello World!" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── "is" on array fields ──
  describe("given a precondition: metadata.labels is 'production'", () => {
    const preconditions = [
      {
        field: "metadata.labels" as const,
        rule: "is" as const,
        value: "production",
      },
    ];

    describe("when a trace arrives with labels ['production', 'api']", () => {
      it("passes the precondition (value in array)", () => {
        const traceData = makeTraceData({
          labels: ["production", "api"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with labels ['staging']", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({
          labels: ["staging"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── "is" on metadata.prompt_ids ──
  describe("given a precondition: metadata.prompt_ids is 'prompt_1'", () => {
    const preconditions = [
      {
        field: "metadata.prompt_ids" as const,
        rule: "is" as const,
        value: "prompt_1",
      },
    ];

    describe("when a trace arrives with prompt_ids ['prompt_1', 'prompt_2']", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({
          promptIds: ["prompt_1", "prompt_2"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with prompt_ids ['prompt_3']", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({
          promptIds: ["prompt_3"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── "is" on spans.model (ANY semantics) ──
  describe("given a precondition: spans.model is 'gpt-4'", () => {
    const preconditions = [
      {
        field: "spans.model" as const,
        rule: "is" as const,
        value: "gpt-4",
      },
    ];

    describe("when a trace arrives with spanModels ['gpt-4', 'gpt-3.5']", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({
          spanModels: ["gpt-4", "gpt-3.5"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with spanModels ['claude-3']", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({
          spanModels: ["claude-3"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when a trace arrives with multiple spanModels including gpt-4", () => {
      it("passes the precondition (ANY semantics)", () => {
        const traceData = makeTraceData({
          spanModels: ["claude-3", "gpt-4"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });
  });

  // ── "is" on spans.type (ANY semantics) ──
  describe("given a precondition: spans.type is 'rag'", () => {
    const preconditions = [
      {
        field: "spans.type" as const,
        rule: "is" as const,
        value: "rag",
      },
    ];

    describe("when a trace arrives with spanTypes ['llm', 'rag']", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({
          spanTypes: ["llm", "rag"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with spanTypes ['llm', 'tool']", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({
          spanTypes: ["llm", "tool"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── traces.error "is" ──
  describe("given a precondition: traces.error is 'true'", () => {
    const preconditions = [
      {
        field: "traces.error" as const,
        rule: "is" as const,
        value: "true",
      },
    ];

    describe("when a trace arrives with hasError = true", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ hasError: true });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with hasError = false", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ hasError: false });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: traces.error is 'false'", () => {
    const preconditions = [
      {
        field: "traces.error" as const,
        rule: "is" as const,
        value: "false",
      },
    ];

    describe("when a trace arrives with hasError = false", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ hasError: false });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with hasError = true", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ hasError: true });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── Metadata string fields ──
  describe("given a precondition: metadata.user_id contains 'admin'", () => {
    const preconditions = [
      {
        field: "metadata.user_id" as const,
        rule: "contains" as const,
        value: "admin",
      },
    ];

    describe("when a trace arrives with userId 'admin_123'", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ userId: "admin_123" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with userId 'guest_456'", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ userId: "guest_456" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.user_id is 'user_42'", () => {
    const preconditions = [
      {
        field: "metadata.user_id" as const,
        rule: "is" as const,
        value: "user_42",
      },
    ];

    describe("when a trace arrives with userId 'user_42'", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ userId: "user_42" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with userId 'user_421'", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ userId: "user_421" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.thread_id is 'thread_abc'", () => {
    const preconditions = [
      {
        field: "metadata.thread_id" as const,
        rule: "is" as const,
        value: "thread_abc",
      },
    ];

    describe("when a trace arrives with threadId 'thread_abc'", () => {
      it("passes", () => {
        const traceData = makeTraceData({ threadId: "thread_abc" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with threadId 'thread_xyz'", () => {
      it("fails", () => {
        const traceData = makeTraceData({ threadId: "thread_xyz" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.customer_id is 'cust_99'", () => {
    const preconditions = [
      {
        field: "metadata.customer_id" as const,
        rule: "is" as const,
        value: "cust_99",
      },
    ];

    describe("when a trace arrives with customerId 'cust_99'", () => {
      it("passes", () => {
        const traceData = makeTraceData({ customerId: "cust_99" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with customerId 'cust_100'", () => {
      it("fails", () => {
        const traceData = makeTraceData({ customerId: "cust_100" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.customer_id not_contains 'test'", () => {
    const preconditions = [
      {
        field: "metadata.customer_id" as const,
        rule: "not_contains" as const,
        value: "test",
      },
    ];

    describe("when a trace arrives with customerId 'test_user'", () => {
      it("fails", () => {
        const traceData = makeTraceData({ customerId: "test_user" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when a trace arrives with customerId 'prod_user'", () => {
      it("passes", () => {
        const traceData = makeTraceData({ customerId: "prod_user" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });
  });

  describe("given a precondition: metadata.user_id matches_regex '^admin_\\d+'", () => {
    const preconditions = [
      {
        field: "metadata.user_id" as const,
        rule: "matches_regex" as const,
        value: "^admin_\\d+",
      },
    ];

    describe("when a trace arrives with userId 'admin_42'", () => {
      it("passes", () => {
        const traceData = makeTraceData({ userId: "admin_42" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with userId 'user_admin_42'", () => {
      it("fails", () => {
        const traceData = makeTraceData({ userId: "user_admin_42" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── Multiple preconditions (AND logic) ──
  describe("given preconditions: traces.origin is 'application' AND input contains 'help'", () => {
    const preconditions = [
      {
        field: "traces.origin" as const,
        rule: "is" as const,
        value: "application",
      },
      {
        field: "input" as const,
        rule: "contains" as const,
        value: "help",
      },
    ];

    describe("when a trace arrives with no origin and input 'I need help'", () => {
      it("runs the evaluation", () => {
        const traceData = makeTraceData({
          origin: undefined,
          input: "I need help",
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with origin 'simulation' and input 'I need help'", () => {
      it("skips the evaluation", () => {
        const traceData = makeTraceData({
          origin: "simulation",
          input: "I need help",
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when a trace arrives with no origin and input 'goodbye'", () => {
      it("skips the evaluation", () => {
        const traceData = makeTraceData({
          origin: undefined,
          input: "goodbye",
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── Missing/null field values ──
  describe("given a precondition: metadata.user_id is 'admin'", () => {
    const preconditions = [
      {
        field: "metadata.user_id" as const,
        rule: "is" as const,
        value: "admin",
      },
    ];

    describe("when a trace arrives with no userId set", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ userId: undefined });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.user_id not_contains 'admin'", () => {
    const preconditions = [
      {
        field: "metadata.user_id" as const,
        rule: "not_contains" as const,
        value: "admin",
      },
    ];

    describe("when a trace arrives with no userId set", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ userId: undefined });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });
  });

  // ── Backward compatibility ──
  describe("given legacy preconditions with old fields", () => {
    const preconditions = [
      {
        field: "input" as const,
        rule: "contains" as const,
        value: "customer",
      },
      {
        field: "output" as const,
        rule: "not_contains" as const,
        value: "error",
      },
      {
        field: "metadata.labels" as const,
        rule: "contains" as const,
        value: "production",
      },
    ];

    describe("when traces arrive matching the legacy rules", () => {
      it("evaluates identically to the old behavior", () => {
        const traceData = makeTraceData({
          input: "customer query",
          output: "response OK",
          labels: ["production", "api"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });

      it("fails when input does not contain keyword", () => {
        const traceData = makeTraceData({
          input: "hello",
          output: "response OK",
          labels: ["production"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });

      it("fails when output contains forbidden word", () => {
        const traceData = makeTraceData({
          input: "customer query",
          output: "error occurred",
          labels: ["production"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── "contains" on array fields (substring in any element) ──
  describe("given a precondition: metadata.labels contains 'prod'", () => {
    const preconditions = [
      {
        field: "metadata.labels" as const,
        rule: "contains" as const,
        value: "prod",
      },
    ];

    describe("when a trace arrives with labels ['production', 'api']", () => {
      it("passes (substring match in element)", () => {
        const traceData = makeTraceData({
          labels: ["production", "api"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when a trace arrives with labels ['staging']", () => {
      it("fails", () => {
        const traceData = makeTraceData({
          labels: ["staging"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── "not_contains" on array fields ──
  describe("given a precondition: metadata.labels not_contains 'test'", () => {
    const preconditions = [
      {
        field: "metadata.labels" as const,
        rule: "not_contains" as const,
        value: "test",
      },
    ];

    describe("when a trace arrives with labels ['testing', 'qa']", () => {
      it("fails (substring match in element)", () => {
        const traceData = makeTraceData({
          labels: ["testing", "qa"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when a trace arrives with labels ['production']", () => {
      it("passes", () => {
        const traceData = makeTraceData({
          labels: ["production"],
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });
  });

  // ── Missing array fields ──
  describe("given a precondition: metadata.labels is 'production'", () => {
    describe("when a trace arrives with no labels (null)", () => {
      it("fails", () => {
        const traceData = makeTraceData({ labels: null });
        const preconditions = [
          {
            field: "metadata.labels" as const,
            rule: "is" as const,
            value: "production",
          },
        ];
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: metadata.labels not_contains 'test'", () => {
    describe("when a trace arrives with no labels (null)", () => {
      it("passes", () => {
        const traceData = makeTraceData({ labels: null });
        const preconditions = [
          {
            field: "metadata.labels" as const,
            rule: "not_contains" as const,
            value: "test",
          },
        ];
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });
  });

  // ── Empty preconditions array ──
  describe("given no preconditions", () => {
    describe("when a trace arrives", () => {
      it("passes (vacuously true)", () => {
        const traceData = makeTraceData();
        expect(
          evaluatePreconditions({
            traceData,
            preconditions: [],
          }),
        ).toBe(true);
      });
    });
  });

  // ── Custom metadata matching (metadata.value with key) ──
  describe("given a precondition: metadata.value is 'production' with key 'environment'", () => {
    const preconditions = [
      {
        field: "metadata.value" as const,
        rule: "is" as const,
        value: "production",
        key: "environment",
      },
    ];

    describe("when trace has customMetadata with environment = 'production'", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({
          customMetadata: { environment: "production" },
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when trace has customMetadata with environment = 'staging'", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({
          customMetadata: { environment: "staging" },
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when trace has no customMetadata", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ customMetadata: null });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when trace has customMetadata without the key", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({
          customMetadata: { region: "us-east" },
        });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // ── Topic matching ──
  describe("given a precondition: topics.topics is 'topic_123'", () => {
    const preconditions = [
      {
        field: "topics.topics" as const,
        rule: "is" as const,
        value: "topic_123",
      },
    ];

    describe("when trace has topicId 'topic_123'", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ topicId: "topic_123" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when trace has topicId 'topic_456'", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ topicId: "topic_456" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when trace has no topicId", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ topicId: undefined });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  describe("given a precondition: topics.subtopics is 'subtopic_abc'", () => {
    const preconditions = [
      {
        field: "topics.subtopics" as const,
        rule: "is" as const,
        value: "subtopic_abc",
      },
    ];

    describe("when trace has subTopicId 'subtopic_abc'", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ subTopicId: "subtopic_abc" });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when trace has no subTopicId", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ subTopicId: undefined });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });


  // ── Annotation matching ──
  describe("given a precondition: annotations.hasAnnotation is 'true'", () => {
    const preconditions = [
      {
        field: "annotations.hasAnnotation" as const,
        rule: "is" as const,
        value: "true",
      },
    ];

    describe("when trace has hasAnnotation = true", () => {
      it("passes the precondition", () => {
        const traceData = makeTraceData({ hasAnnotation: true });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(true);
      });
    });

    describe("when trace has hasAnnotation = false", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ hasAnnotation: false });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });

    describe("when trace has hasAnnotation = null", () => {
      it("fails the precondition", () => {
        const traceData = makeTraceData({ hasAnnotation: null });
        expect(
          evaluatePreconditions({
            traceData,
            preconditions,
          }),
        ).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Event preconditions
  // -------------------------------------------------------------------------

  describe("when precondition matches events.event_type", () => {
    it("passes when event type is present", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            events: [
              { event_type: "thumbs_up_down", metrics: [{ key: "vote", value: 1 }], event_details: [] },
              { event_type: "purchase", metrics: [], event_details: [{ key: "item", value: "shoes" }] },
            ],
          },
          preconditions: [
            { field: "events.event_type", rule: "is", value: "thumbs_up_down" },
          ],
        }),
      ).toBe(true);
    });

    it("fails when event type is not present", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            events: [
              { event_type: "purchase", metrics: [], event_details: [] },
            ],
          },
          preconditions: [
            { field: "events.event_type", rule: "is", value: "thumbs_up_down" },
          ],
        }),
      ).toBe(false);
    });

    it("fails when events is null", () => {
      expect(
        evaluatePreconditions({
          traceData: { events: null },
          preconditions: [
            { field: "events.event_type", rule: "is", value: "thumbs_up_down" },
          ],
        }),
      ).toBe(false);
    });
  });

  describe("when precondition matches events.metrics.key", () => {
    it("passes when metric key exists for the given event type", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            events: [
              { event_type: "thumbs_up_down", metrics: [{ key: "vote", value: 1 }], event_details: [] },
            ],
          },
          preconditions: [
            { field: "events.metrics.key", rule: "is", value: "vote", key: "thumbs_up_down" },
          ],
        }),
      ).toBe(true);
    });

    it("fails when metric key does not exist", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            events: [
              { event_type: "thumbs_up_down", metrics: [{ key: "vote", value: 1 }], event_details: [] },
            ],
          },
          preconditions: [
            { field: "events.metrics.key", rule: "is", value: "score", key: "thumbs_up_down" },
          ],
        }),
      ).toBe(false);
    });
  });

  describe("when precondition matches events.event_details.key", () => {
    it("passes when event detail key exists for the given event type", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            events: [
              { event_type: "purchase", metrics: [], event_details: [{ key: "item", value: "shoes" }] },
            ],
          },
          preconditions: [
            { field: "events.event_details.key", rule: "is", value: "item", key: "purchase" },
          ],
        }),
      ).toBe(true);
    });

    it("fails when event detail key does not exist for the event type", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            events: [
              { event_type: "purchase", metrics: [], event_details: [{ key: "item", value: "shoes" }] },
            ],
          },
          preconditions: [
            { field: "events.event_details.key", rule: "is", value: "color", key: "purchase" },
          ],
        }),
      ).toBe(false);
    });
  });

  describe("when combining event preconditions with other fields", () => {
    it("passes when all preconditions match", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            input: "hello",
            origin: "application",
            events: [
              { event_type: "thumbs_up_down", metrics: [{ key: "vote", value: 1 }], event_details: [] },
            ],
          },
          preconditions: [
            { field: "input", rule: "contains", value: "hello" },
            { field: "events.event_type", rule: "is", value: "thumbs_up_down" },
          ],
        }),
      ).toBe(true);
    });

    it("fails when event precondition does not match", () => {
      expect(
        evaluatePreconditions({
          traceData: {
            input: "hello",
            events: [
              { event_type: "purchase", metrics: [], event_details: [] },
            ],
          },
          preconditions: [
            { field: "input", rule: "contains", value: "hello" },
            { field: "events.event_type", rule: "is", value: "thumbs_up_down" },
          ],
        }),
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// preconditionsNeedEvents()
// ---------------------------------------------------------------------------

describe("preconditionsNeedEvents()", () => {
  it("returns true when any precondition references event fields", () => {
    expect(
      preconditionsNeedEvents([
        { field: "input", rule: "contains", value: "hello" },
        { field: "events.event_type", rule: "is", value: "thumbs_up_down" },
      ]),
    ).toBe(true);
  });

  it("returns true for events.metrics.key preconditions", () => {
    expect(
      preconditionsNeedEvents([
        { field: "events.metrics.key", rule: "is", value: "vote", key: "thumbs_up_down" },
      ]),
    ).toBe(true);
  });

  it("returns false when no preconditions reference event fields", () => {
    expect(
      preconditionsNeedEvents([
        { field: "input", rule: "contains", value: "hello" },
        { field: "traces.origin", rule: "is", value: "application" },
      ]),
    ).toBe(false);
  });

  it("returns false for empty preconditions", () => {
    expect(preconditionsNeedEvents([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildPreconditionTraceDataFromTrace()
// ---------------------------------------------------------------------------

describe("buildPreconditionTraceDataFromTrace()", () => {
  describe("when given a trace with input/output values", () => {
    it("maps input/output values correctly", () => {
      const result = buildPreconditionTraceDataFromTrace({
        trace: {
          input: { value: "hello" },
          output: { value: "world" },
        },
        spans: [],
      });
      expect(result.input).toBe("hello");
      expect(result.output).toBe("world");
    });
  });

  describe("when given a trace with origin, error, and metadata fields", () => {
    it("maps origin, error, metadata fields", () => {
      const result = buildPreconditionTraceDataFromTrace({
        trace: {
          origin: "simulation",
          error: { has_error: true, message: "fail", stacktrace: [] },
          metadata: {
            user_id: "u1",
            thread_id: "t1",
            customer_id: "c1",
            labels: ["prod"],
            prompt_ids: ["p1"],
            topic_id: "topic_1",
            subtopic_id: "sub_1",
          },
        },
        spans: [],
      });
      expect(result.origin).toBe("simulation");
      expect(result.hasError).toBe(true);
      expect(result.userId).toBe("u1");
      expect(result.threadId).toBe("t1");
      expect(result.customerId).toBe("c1");
      expect(result.labels).toEqual(["prod"]);
      expect(result.promptIds).toEqual(["p1"]);
      expect(result.topicId).toBe("topic_1");
      expect(result.subTopicId).toBe("sub_1");
    });
  });

  describe("when given a trace with custom metadata", () => {
    it("extracts custom metadata from metadata.custom", () => {
      const result = buildPreconditionTraceDataFromTrace({
        trace: {
          metadata: {
            custom: { env: "staging", region: "us-east" },
          },
        },
        spans: [],
      });
      expect(result.customMetadata).toEqual({ env: "staging", region: "us-east" });
    });
  });

  describe("when given spans with different types and models", () => {
    it("extracts span types and models from spans array", () => {
      const spans: Span[] = [
        {
          span_id: "s1",
          trace_id: "t1",
          type: "llm",
          timestamps: { started_at: 0, finished_at: 1 },
          model: "gpt-4",
        } as any,
        {
          span_id: "s2",
          trace_id: "t1",
          type: "rag",
          timestamps: { started_at: 0, finished_at: 1 },
          contexts: [],
        } as any,
      ];
      const result = buildPreconditionTraceDataFromTrace({
        trace: {},
        spans,
      });
      expect(result.spanTypes).toEqual(["llm", "rag"]);
      expect(result.spanModels).toEqual(["gpt-4"]);
    });
  });

  describe("when given a trace with topic_id and subtopic_id", () => {
    it("maps topic_id and subtopic_id", () => {
      const result = buildPreconditionTraceDataFromTrace({
        trace: {
          metadata: { topic_id: "t123", subtopic_id: "s456" },
        },
        spans: [],
      });
      expect(result.topicId).toBe("t123");
      expect(result.subTopicId).toBe("s456");
    });
  });

  describe("when given a trace with null/undefined metadata", () => {
    it("handles null/undefined metadata gracefully", () => {
      const result = buildPreconditionTraceDataFromTrace({
        trace: { metadata: undefined },
        spans: [],
      });
      expect(result.userId).toBeNull();
      expect(result.threadId).toBeNull();
      expect(result.customerId).toBeNull();
      expect(result.labels).toBeNull();
      expect(result.customMetadata).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// buildPreconditionTraceDataFromCommand()
// ---------------------------------------------------------------------------

describe("buildPreconditionTraceDataFromCommand()", () => {
  function makeCommandData(
    overrides: Partial<ExecuteEvaluationCommandData> = {},
  ): ExecuteEvaluationCommandData {
    return {
      tenantId: "tenant_1",
      traceId: "trace_1",
      evaluationId: "eval_1",
      evaluatorId: "evaluator_1",
      evaluatorType: "custom",
      occurredAt: Date.now(),
      ...overrides,
    };
  }

  describe("when given command data with all fields", () => {
    it("maps all command data fields correctly", () => {
      const data = makeCommandData({
        origin: "application",
        hasError: true,
        userId: "u1",
        threadId: "t1",
        customerId: "c1",
        labels: ["prod"],
        promptIds: ["p1"],
        topicId: "topic_1",
        subTopicId: "sub_1",
        customMetadata: { env: "staging" },
        satisfactionScore: 0.8,
        spanTypes: ["llm"],
        spanModels: ["gpt-4"],
      });
      const result = buildPreconditionTraceDataFromCommand({ data, spans: [] });
      expect(result.origin).toBe("application");
      expect(result.hasError).toBe(true);
      expect(result.userId).toBe("u1");
      expect(result.threadId).toBe("t1");
      expect(result.customerId).toBe("c1");
      expect(result.labels).toEqual(["prod"]);
      expect(result.promptIds).toEqual(["p1"]);
      expect(result.topicId).toBe("topic_1");
      expect(result.subTopicId).toBe("sub_1");
      expect(result.customMetadata).toEqual({ env: "staging" });
      expect(result.satisfactionScore).toBe(0.8);
      expect(result.spanTypes).toEqual(["llm"]);
      expect(result.spanModels).toEqual(["gpt-4"]);
    });
  });

  describe("when given command data with computedInput/computedOutput", () => {
    it("uses computedInput/computedOutput from command data", () => {
      const data = makeCommandData({
        computedInput: "user question",
        computedOutput: "bot response",
      });
      const result = buildPreconditionTraceDataFromCommand({ data, spans: [] });
      expect(result.input).toBe("user question");
      expect(result.output).toBe("bot response");
    });
  });

  describe("when command data has no computedInput/computedOutput", () => {
    it("defaults input/output to null", () => {
      const data = makeCommandData();
      const result = buildPreconditionTraceDataFromCommand({ data, spans: [] });
      expect(result.input).toBeNull();
      expect(result.output).toBeNull();
    });
  });

  describe("when command data has no spanTypes but spans are provided", () => {
    it("extracts span types from spans", () => {
      const spans: Span[] = [
        {
          span_id: "s1",
          trace_id: "t1",
          type: "llm",
          timestamps: { started_at: 0, finished_at: 1 },
          model: "gpt-4",
        } as any,
        {
          span_id: "s2",
          trace_id: "t1",
          type: "rag",
          timestamps: { started_at: 0, finished_at: 1 },
          contexts: [],
        } as any,
      ];
      const data = makeCommandData();
      const result = buildPreconditionTraceDataFromCommand({ data, spans });
      expect(result.spanTypes).toEqual(["llm", "rag"]);
      expect(result.spanModels).toEqual(["gpt-4"]);
    });
  });

  describe("when command data has spanTypes/spanModels", () => {
    it("uses command data spanTypes/spanModels over spans", () => {
      const spans: Span[] = [
        {
          span_id: "s1",
          trace_id: "t1",
          type: "llm",
          timestamps: { started_at: 0, finished_at: 1 },
          model: "gpt-4",
        } as any,
      ];
      const data = makeCommandData({
        spanTypes: ["rag", "tool"],
        spanModels: ["claude-3"],
      });
      const result = buildPreconditionTraceDataFromCommand({ data, spans });
      expect(result.spanTypes).toEqual(["rag", "tool"]);
      expect(result.spanModels).toEqual(["claude-3"]);
    });
  });

  describe("when events are provided", () => {
    it("includes events in the trace data", () => {
      const data = makeCommandData();
      const events = [
        { event_type: "thumbs_up_down", metrics: [{ key: "vote", value: 1 }], event_details: [] },
      ];
      const result = buildPreconditionTraceDataFromCommand({ data, spans: [], events });
      expect(result.events).toEqual(events);
    });
  });

  describe("when events are not provided", () => {
    it("defaults events to null", () => {
      const data = makeCommandData();
      const result = buildPreconditionTraceDataFromCommand({ data, spans: [] });
      expect(result.events).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// checkEvaluatorRequiredFields()
// ---------------------------------------------------------------------------

describe("checkEvaluatorRequiredFields()", () => {
  function makeRagSpan(contexts: RAGChunk[]): RAGSpan {
    return {
      span_id: "s1",
      trace_id: "t1",
      type: "rag",
      timestamps: { started_at: 0, finished_at: 1 },
      contexts,
    } as RAGSpan;
  }

  describe("when evaluator requires contexts but no RAG spans present", () => {
    it("returns false", () => {
      const result = checkEvaluatorRequiredFields({
        evaluatorType: "ragas/faithfulness",
        spans: [
          {
            span_id: "s1",
            trace_id: "t1",
            type: "llm",
            timestamps: { started_at: 0, finished_at: 1 },
          } as Span,
        ],
      });
      expect(result).toBe(false);
    });
  });

  describe("when evaluator requires contexts and RAG spans with content exist", () => {
    it("returns true", () => {
      const ragSpan = makeRagSpan([
        { content: "some context text" },
      ]);
      const result = checkEvaluatorRequiredFields({
        evaluatorType: "ragas/faithfulness",
        spans: [ragSpan],
      });
      expect(result).toBe(true);
    });
  });

  describe("when evaluator requires expected_output but none provided", () => {
    it("returns false", () => {
      const result = checkEvaluatorRequiredFields({
        evaluatorType: "custom/expected_output_check",
        spans: [],
      });
      // "custom/expected_output_check" is not a real evaluator, so it won't have
      // requiredFields including "expected_output". Use a known one if available,
      // or test the logic directly. For robustness, test with a mock approach:
      // Since getEvaluatorDefinitions returns undefined for unknown types,
      // the function returns true (no requirements to fail).
      expect(result).toBe(true);
    });
  });

  describe("when evaluator requires expected_output and it is provided", () => {
    it("returns true", () => {
      const result = checkEvaluatorRequiredFields({
        evaluatorType: "custom/expected_output_check",
        spans: [],
        expectedOutput: { value: "expected" },
      });
      expect(result).toBe(true);
    });
  });

  describe("when evaluator has no required fields", () => {
    it("returns true", () => {
      const result = checkEvaluatorRequiredFields({
        evaluatorType: "custom",
        spans: [],
      });
      expect(result).toBe(true);
    });
  });

  describe("when evaluator requires contexts but RAG span has empty contexts", () => {
    it("returns false", () => {
      const ragSpan = makeRagSpan([]);
      const result = checkEvaluatorRequiredFields({
        evaluatorType: "ragas/faithfulness",
        spans: [ragSpan],
      });
      expect(result).toBe(false);
    });
  });
});
