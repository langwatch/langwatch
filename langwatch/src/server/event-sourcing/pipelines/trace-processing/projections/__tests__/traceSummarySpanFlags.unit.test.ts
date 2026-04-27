import { describe, expect, it } from "vitest";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

describe("traceSummary span flags", () => {
  describe("rootSpanName", () => {
    describe("when a root span arrives", () => {
      it("captures the root span name", () => {
        const state = createInitState();
        const span = createTestSpan({
          parentSpanId: null,
          name: "POST /api/chat",
        });

        const result = applySpanToSummary({ state, span });

        expect(result.rootSpanName).toBe("POST /api/chat");
      });
    });

    describe("when a second root span arrives", () => {
      it("keeps the first root span name (first-write-wins)", () => {
        let state = createInitState();
        state = applySpanToSummary({
          state,
          span: createTestSpan({
            spanId: "root-1",
            parentSpanId: null,
            name: "first-root",
          }),
        });

        const result = applySpanToSummary({
          state,
          span: createTestSpan({
            spanId: "root-2",
            parentSpanId: null,
            name: "second-root",
          }),
        });

        expect(result.rootSpanName).toBe("first-root");
      });
    });

    describe("when only child spans arrive", () => {
      it("leaves rootSpanName as null", () => {
        const state = createInitState();
        const span = createTestSpan({
          parentSpanId: "some-parent",
          name: "child-span",
        });

        const result = applySpanToSummary({ state, span });

        expect(result.rootSpanName).toBeNull();
      });
    });
  });

  describe("rootSpanType", () => {
    describe("when a root span has a span type", () => {
      it("captures the root span type", () => {
        const state = createInitState();
        const span = createTestSpan({
          parentSpanId: null,
          name: "agent-handler",
          spanAttributes: { "langwatch.span.type": "agent" },
        });

        const result = applySpanToSummary({ state, span });

        expect(result.rootSpanType).toBe("agent");
      });
    });

    describe("when a root span has no span type attribute", () => {
      it("sets rootSpanType to null", () => {
        const state = createInitState();
        const span = createTestSpan({
          parentSpanId: null,
          name: "generic-handler",
          spanAttributes: {},
        });

        const result = applySpanToSummary({ state, span });

        expect(result.rootSpanType).toBeNull();
      });
    });
  });

  describe("containsAi", () => {
    describe("when an LLM span arrives", () => {
      it("sets containsAi to true", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: { "langwatch.span.type": "llm" },
        });

        const result = applySpanToSummary({ state, span });

        expect(result.containsAi).toBe(true);
      });
    });

    describe("when an agent span arrives", () => {
      it("sets containsAi to true", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: { "langwatch.span.type": "agent" },
        });

        const result = applySpanToSummary({ state, span });

        expect(result.containsAi).toBe(true);
      });
    });

    describe("when a tool span arrives", () => {
      it("sets containsAi to true", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: { "langwatch.span.type": "tool" },
        });

        const result = applySpanToSummary({ state, span });

        expect(result.containsAi).toBe(true);
      });
    });

    describe("when a rag span arrives", () => {
      it("sets containsAi to true", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: { "langwatch.span.type": "rag" },
        });

        const result = applySpanToSummary({ state, span });

        expect(result.containsAi).toBe(true);
      });
    });

    describe("when a non-AI span arrives", () => {
      it("keeps containsAi as false", () => {
        const state = createInitState();
        const span = createTestSpan({
          spanAttributes: { "langwatch.span.type": "chain" },
        });

        const result = applySpanToSummary({ state, span });

        expect(result.containsAi).toBe(false);
      });
    });

    describe("when containsAi is already true and a non-AI span arrives", () => {
      it("stays true (sticky flag)", () => {
        let state = createInitState();
        state = applySpanToSummary({
          state,
          span: createTestSpan({
            spanId: "llm-1",
            spanAttributes: { "langwatch.span.type": "llm" },
          }),
        });

        const result = applySpanToSummary({
          state,
          span: createTestSpan({
            spanId: "chain-1",
            spanAttributes: { "langwatch.span.type": "chain" },
          }),
        });

        expect(result.containsAi).toBe(true);
      });
    });

    describe("when a span has no type attribute", () => {
      it("keeps containsAi as false", () => {
        const state = createInitState();
        const span = createTestSpan({ spanAttributes: {} });

        const result = applySpanToSummary({ state, span });

        expect(result.containsAi).toBe(false);
      });
    });
  });

  describe("given a synthetic span", () => {
    describe("when it has AI-related type", () => {
      it("does not change any flags", () => {
        const state = createInitState();
        const span = createTestSpan({
          parentSpanId: null,
          name: "langwatch.track_event",
          spanAttributes: { "langwatch.span.type": "llm" },
        });

        const result = applySpanToSummary({ state, span });

        expect(result.rootSpanName).toBeNull();
        expect(result.containsAi).toBe(false);
        expect(result.spanCount).toBe(0);
      });
    });
  });
});
