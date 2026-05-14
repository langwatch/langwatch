import { describe, expect, it } from "vitest";
import { applySpanToSummary } from "../traceSummary.foldProjection";
import {
  createInitState,
  createTestSpan,
} from "./fixtures/trace-summary-test.fixtures";

describe("traceSummary span flags", () => {
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

        expect(result.rootSpanType).toBeNull();
        expect(result.containsAi).toBe(false);
        expect(result.spanCount).toBe(0);
      });
    });

    describe("when it carries an event payload", () => {
      it("hoists the event onto the trace summary", () => {
        // /api/track_event creates a synthetic `langwatch.track_event`
        // span and stuffs the user-tracked event into `span.events`. The
        // synthetic-span guard used to early-return before
        // `accumulateEvents` ran, so the event vanished. Pin the fix.
        const state = createInitState();
        const span = createTestSpan({
          parentSpanId: null,
          name: "langwatch.track_event",
          spanId: "evt-span-1",
          events: [
            {
              name: "thumbs_up_down",
              timeUnixMs: 1700,
              attributes: { value: "up" },
            },
          ],
        });

        const result = applySpanToSummary({ state, span });

        expect(result.events).toHaveLength(1);
        expect(result.events?.[0]).toMatchObject({
          spanId: "evt-span-1",
          name: "thumbs_up_down",
          attributes: { value: "up" },
        });
        // Timing/cost still un-touched — synthetic spans don't represent
        // real execution.
        expect(result.spanCount).toBe(0);
      });
    });
  });
});
