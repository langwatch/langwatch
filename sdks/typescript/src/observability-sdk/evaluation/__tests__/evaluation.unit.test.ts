import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  context,
  trace,
  INVALID_SPAN_CONTEXT,
  type ContextManager,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { MockSpan, MockTracerProvider } from "../../__tests__/test-utils";
import { createLangWatchSpan } from "../../span";
import { getLangWatchTracerFromProvider } from "../../tracer";
import { ATTR_LANGWATCH_EVALUATION_CUSTOM } from "../../semconv/attributes";
import { emitEvaluationEvent } from "../index";

/**
 * The complete set of keys the emitted payload must contain, matching the
 * Python `Evaluation` TypedDict (`python-sdk/.../domain/__init__.py`) exactly.
 * Notably there is NO `cost` key: Python routes cost into span metrics, not the
 * evaluation event payload.
 */
const EXPECTED_PAYLOAD_KEYS = [
  "evaluation_id",
  "span_id",
  "name",
  "type",
  "is_guardrail",
  "status",
  "passed",
  "score",
  "label",
  "details",
  "error",
  "timestamps",
] as const;

const EVENT_NAME = "langwatch.evaluation.custom";

describe("addEvaluation", () => {
  // A real context manager is required so `context.with(...)` propagates the
  // active span to `trace.getActiveSpan()` in the trace-level tests. The
  // default no-op manager does not propagate.
  let contextManager: ContextManager;
  beforeAll(() => {
    contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
  });
  afterAll(() => {
    contextManager.disable();
    context.disable();
  });

  it("uses the canonical custom-evaluation event name constant", () => {
    // Guards that the constant we emit under stays wire-compatible with Python.
    expect(ATTR_LANGWATCH_EVALUATION_CUSTOM).toBe(EVENT_NAME);
  });

  describe("span.addEvaluation", () => {
    it("emits a langwatch.evaluation.custom event with the snake_case payload", () => {
      const mockSpan = new MockSpan("evaluation-target");
      const span = createLangWatchSpan(mockSpan);

      const result = span.addEvaluation({
        name: "response_quality",
        passed: true,
        score: 0.95,
        details: "High quality response",
      });

      // Fluent API returns the span.
      expect(result).toBe(span);

      const event = mockSpan.getEvent(EVENT_NAME);
      expect(event).toBeDefined();
      expect(event?.name).toBe(ATTR_LANGWATCH_EVALUATION_CUSTOM);

      const raw = event?.attributes?.json_encoded_event;
      expect(typeof raw).toBe("string");

      const payload = JSON.parse(raw as string);

      // Provided fields serialized under Python-parity snake_case keys.
      expect(payload.name).toBe("response_quality");
      expect(payload.passed).toBe(true);
      expect(payload.score).toBe(0.95);
      expect(payload.details).toBe("High quality response");

      // status defaults to "processed" (matching Python).
      expect(payload.status).toBe("processed");

      // span_id is pulled from the span context.
      expect(payload.span_id).toBe(mockSpan.spanContext().spanId);

      // evaluation_id is auto-generated with the "eval_" prefix (PKSUID parity).
      expect(typeof payload.evaluation_id).toBe("string");
      expect(payload.evaluation_id).toMatch(/^eval_/);

      // Absent optional fields are present as null, matching Python's explicit
      // key emission.
      expect(payload).toHaveProperty("type", null);
      expect(payload).toHaveProperty("is_guardrail", null);
      expect(payload).toHaveProperty("label", null);
      expect(payload).toHaveProperty("error", null);
      expect(payload).toHaveProperty("timestamps", null);

      // The payload keys must be EXACTLY the Python `Evaluation` TypedDict set
      // (12 keys, no `cost`) — cost lives in span metrics on the Python side.
      expect(Object.keys(payload).sort()).toEqual(
        [...EXPECTED_PAYLOAD_KEYS].sort(),
      );
    });

    it("emits span_id as null for an invalid / non-recording span context", () => {
      // An invalid span context carries the all-zero span id that OTel JS hands
      // back outside an active trace. Python guards this via `is_valid` and
      // emits null; we must match by guarding on `isSpanContextValid`.
      //
      // Use a MockSpan (which records events so we can read the payload back)
      // but override its context to the OTel-canonical INVALID_SPAN_CONTEXT so
      // the real `isSpanContextValid` path is exercised.
      const mockSpan = new MockSpan("invalid-ctx-target");
      mockSpan.spanContext = () => INVALID_SPAN_CONTEXT;

      // Sanity: this really is the all-zero span id that must be rejected.
      expect(mockSpan.spanContext().spanId).toBe("0000000000000000");

      emitEvaluationEvent(mockSpan, { name: "invalid_ctx_eval" });

      const event = mockSpan.getEvent(EVENT_NAME);
      expect(event).toBeDefined();
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(payload.name).toBe("invalid_ctx_eval");
      // The guard converts the all-zero id to null.
      expect(payload.span_id).toBeNull();
    });

    it("honors an explicit evaluationId and non-default status", () => {
      const mockSpan = new MockSpan("evaluation-target-2");
      const span = createLangWatchSpan(mockSpan);

      span.addEvaluation({
        name: "toxicity",
        evaluationId: "eval_custom_123",
        status: "skipped",
        isGuardrail: true,
      });

      const event = mockSpan.getEvent(EVENT_NAME);
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(payload.evaluation_id).toBe("eval_custom_123");
      expect(payload.status).toBe("skipped");
      expect(payload.is_guardrail).toBe(true);
    });

    it("aliases recordEvaluation to addEvaluation", () => {
      const mockSpan = new MockSpan("evaluation-target-3");
      const span = createLangWatchSpan(mockSpan);

      span.recordEvaluation({ name: "alias_eval", passed: false });

      const event = mockSpan.getEvent(EVENT_NAME);
      expect(event).toBeDefined();
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );
      expect(payload.name).toBe("alias_eval");
      expect(payload.passed).toBe(false);
    });

    it("emits null for error when error is explicitly null", () => {
      const mockSpan = new MockSpan("error-null-target");
      const span = createLangWatchSpan(mockSpan);

      span.addEvaluation({ name: "no_error_eval", error: null });

      const event = mockSpan.getEvent(EVENT_NAME);
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(payload.error).toBeNull();
    });

    it("captures an Error instance with a non-empty message and stacktrace", () => {
      const mockSpan = new MockSpan("error-instance-target");
      const span = createLangWatchSpan(mockSpan);

      span.addEvaluation({ name: "error_eval", error: new Error("boom") });

      const event = mockSpan.getEvent(EVENT_NAME);
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(typeof payload.error.message).toBe("string");
      expect(payload.error.message.length).toBeGreaterThan(0);
      expect(Array.isArray(payload.error.stacktrace)).toBe(true);
      expect(payload.error.stacktrace.length).toBeGreaterThan(0);
    });

    it("captures a non-Error value as a string message with empty stacktrace", () => {
      const mockSpan = new MockSpan("error-string-target");
      const span = createLangWatchSpan(mockSpan);

      span.addEvaluation({ name: "string_error_eval", error: "plain failure" });

      const event = mockSpan.getEvent(EVENT_NAME);
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(payload.error.message).toBe("plain failure");
      expect(payload.error.stacktrace).toEqual([]);
    });

    it("converts Date timestamps to epoch milliseconds", () => {
      const mockSpan = new MockSpan("timestamp-date-target");
      const span = createLangWatchSpan(mockSpan);

      span.addEvaluation({
        name: "timestamp_eval",
        timestamps: { startedAt: new Date(1000), finishedAt: new Date(2000) },
      });

      const event = mockSpan.getEvent(EVENT_NAME);
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(payload.timestamps.started_at).toBe(1000);
      expect(payload.timestamps.finished_at).toBe(2000);
    });

    it("passes through numeric timestamps unchanged", () => {
      const mockSpan = new MockSpan("timestamp-numeric-target");
      const span = createLangWatchSpan(mockSpan);

      span.addEvaluation({
        name: "numeric_timestamp_eval",
        timestamps: { startedAt: 5, finishedAt: 6 },
      });

      const event = mockSpan.getEvent(EVENT_NAME);
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(payload.timestamps.started_at).toBe(5);
      expect(payload.timestamps.finished_at).toBe(6);
    });

    it("preserves score of 0 rather than coercing to null", () => {
      const mockSpan = new MockSpan("score-zero-target");
      const span = createLangWatchSpan(mockSpan);

      span.addEvaluation({ name: "zero_score_eval", score: 0 });

      const event = mockSpan.getEvent(EVENT_NAME);
      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );

      expect(payload.score).toBe(0);
    });
  });

  describe("tracer.addEvaluation (trace-level)", () => {
    it("emits the evaluation event onto the currently active span", () => {
      const mockProvider = new MockTracerProvider();
      const tracer = getLangWatchTracerFromProvider(
        mockProvider,
        "evaluation-test-tracer",
      );

      const mockSpan = new MockSpan("root-span");

      // Make the mock span the active span in the OTel context, mirroring
      // Python's trace-level add_evaluation acting on the trace's root/current
      // span.
      const ctx = trace.setSpan(context.active(), mockSpan);
      context.with(ctx, () => {
        tracer.addEvaluation({
          name: "response_quality",
          passed: true,
          score: 0.95,
        });
      });

      const event = mockSpan.getEvent(EVENT_NAME);
      expect(event).toBeDefined();
      expect(event?.name).toBe(ATTR_LANGWATCH_EVALUATION_CUSTOM);

      const payload = JSON.parse(
        event?.attributes?.json_encoded_event as string,
      );
      expect(payload.name).toBe("response_quality");
      expect(payload.passed).toBe(true);
      expect(payload.score).toBe(0.95);
      expect(payload.status).toBe("processed");
    });

    it("is a no-op when there is no active span", () => {
      const mockProvider = new MockTracerProvider();
      const tracer = getLangWatchTracerFromProvider(
        mockProvider,
        "evaluation-test-tracer-noop",
      );

      // No active span in context -> must not throw.
      expect(() =>
        tracer.addEvaluation({ name: "orphan_eval", passed: true }),
      ).not.toThrow();
    });
  });
});
