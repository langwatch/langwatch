import { describe, expect, it } from "vitest";

import { synthesizeTraceContext } from "../synthesize-trace-context";

const CLAUDE_SCOPE = "com.anthropic.claude_code.events";
const WIRE_TRACE_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const WIRE_SPAN_ID = "1122334455667788";

describe("synthesizeTraceContext", () => {
  describe("when the record already carries complete wire trace context", () => {
    it("passes the wire ids through and marks nothing synthetic", () => {
      const result = synthesizeTraceContext({
        scopeName: CLAUDE_SCOPE,
        wireTraceId: WIRE_TRACE_ID,
        wireSpanId: WIRE_SPAN_ID,
        attrs: { "session.id": "sess_42", "prompt.id": "p_1" },
      });

      expect(result).toEqual({
        traceId: WIRE_TRACE_ID,
        spanId: WIRE_SPAN_ID,
        syntheticTraceId: false,
        syntheticSpanId: false,
        derivedFrom: null,
      });
    });
  });

  describe("when the record carries a real trace_id but no span_id", () => {
    it("preserves the real trace_id and synthesizes only the span_id", () => {
      const result = synthesizeTraceContext({
        scopeName: CLAUDE_SCOPE,
        wireTraceId: WIRE_TRACE_ID,
        wireSpanId: "",
        attrs: {
          "session.id": "sess_42",
          "prompt.id": "p_1",
          "event.name": "user_prompt",
          "event.sequence": "1",
        },
      });

      // Trace grouping is real, so the trace is NOT synthetic and there is
      // no derivedFrom; only the span_id was invented.
      expect(result).toEqual({
        traceId: WIRE_TRACE_ID,
        spanId: "9728b6350fffb34b",
        syntheticTraceId: false,
        syntheticSpanId: true,
        derivedFrom: null,
      });
    });
  });

  describe("when the record carries a real span_id but no trace_id", () => {
    it("preserves the real span_id and synthesizes only the trace_id", () => {
      const result = synthesizeTraceContext({
        scopeName: CLAUDE_SCOPE,
        wireTraceId: "",
        wireSpanId: WIRE_SPAN_ID,
        attrs: {
          "session.id": "sess_42",
          "prompt.id": "p_1",
          "event.name": "user_prompt",
          "event.sequence": "1",
        },
      });

      expect(result).toEqual({
        traceId: "52284def896aaed9327d68e41abe0441",
        spanId: WIRE_SPAN_ID,
        syntheticTraceId: true,
        syntheticSpanId: false,
        derivedFrom: "session.id",
      });
    });
  });

  describe("when a claude_code record arrives without trace context", () => {
    it("derives the exact per-turn trace and per-event span from session.id", () => {
      const result = synthesizeTraceContext({
        scopeName: CLAUDE_SCOPE,
        wireTraceId: "",
        wireSpanId: "",
        attrs: {
          "session.id": "sess_42",
          "prompt.id": "p_1",
          "event.name": "user_prompt",
          "event.sequence": "1",
        },
      });

      expect(result).toEqual({
        traceId: "52284def896aaed9327d68e41abe0441",
        spanId: "9728b6350fffb34b",
        syntheticTraceId: true,
        syntheticSpanId: true,
        derivedFrom: "session.id",
      });
      expect(result.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(result.spanId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("leaves the ids empty and not synthetic when session.id is absent", () => {
      const result = synthesizeTraceContext({
        scopeName: CLAUDE_SCOPE,
        wireTraceId: "",
        wireSpanId: "",
        attrs: { "event.name": "user_prompt" },
      });

      expect(result).toEqual({
        traceId: "",
        spanId: "",
        syntheticTraceId: false,
        syntheticSpanId: false,
        derivedFrom: null,
      });
    });
  });

  describe("when a codex record arrives without trace context", () => {
    it("derives the exact trace from conversation.id and marks it synthetic", () => {
      const result = synthesizeTraceContext({
        scopeName: "codex_exec",
        wireTraceId: "",
        wireSpanId: "",
        attrs: {
          "event.name": "codex.user_prompt",
          "conversation.id": "conv_42",
          "event.sequence": "1",
        },
      });

      expect(result).toEqual({
        traceId: "b3360efff729da240b2482b9155383ef",
        spanId: "80facf4f65be377e",
        syntheticTraceId: true,
        syntheticSpanId: true,
        derivedFrom: "conversation.id",
      });
    });

    it("leaves the ids empty when a codex.* event has no conversation.id or other key", () => {
      const result = synthesizeTraceContext({
        scopeName: "codex_exec",
        wireTraceId: "",
        wireSpanId: "",
        attrs: { "event.name": "codex.sse_event", "event.sequence": "1" },
      });

      expect(result).toEqual({
        traceId: "",
        spanId: "",
        syntheticTraceId: false,
        syntheticSpanId: false,
        derivedFrom: null,
      });
    });
  });

  describe("when an unrecognized scope arrives without trace context", () => {
    // Synthesis is only for the documented coding-agent shapes. Ordinary
    // standalone application logs stay uncorrelated: fusing them by a generic
    // key (session.id on an unknown emitter, or a process-level key like
    // service.instance.id) would build one giant synthetic trace and route
    // every record of that instance to one command shard.
    it("leaves the ids empty even when a session.id attribute is present", () => {
      const result = synthesizeTraceContext({
        scopeName: "some.other.agent",
        wireTraceId: "",
        wireSpanId: "",
        attrs: {
          "session.id": "s",
          "event.name": "my.event",
          "event.sequence": "1",
        },
      });

      expect(result).toEqual({
        traceId: "",
        spanId: "",
        syntheticTraceId: false,
        syntheticSpanId: false,
        derivedFrom: null,
      });
    });

    it("leaves the ids empty even when a conversation.id attribute is present", () => {
      const result = synthesizeTraceContext({
        scopeName: "some.other.agent",
        wireTraceId: "",
        wireSpanId: "",
        attrs: { "conversation.id": "c", "event.name": "my.event" },
      });

      expect(result).toEqual({
        traceId: "",
        spanId: "",
        syntheticTraceId: false,
        syntheticSpanId: false,
        derivedFrom: null,
      });
    });

    it("leaves the ids empty and not synthetic when no correlation key exists", () => {
      const result = synthesizeTraceContext({
        scopeName: "some.other.agent",
        wireTraceId: "",
        wireSpanId: "",
        attrs: { "event.name": "my.event" },
      });

      expect(result).toEqual({
        traceId: "",
        spanId: "",
        syntheticTraceId: false,
        syntheticSpanId: false,
        derivedFrom: null,
      });
    });
  });

  describe("determinism", () => {
    it("derives the same ids for the same input", () => {
      const args = {
        scopeName: CLAUDE_SCOPE,
        wireTraceId: "",
        wireSpanId: "",
        attrs: {
          "session.id": "sess_42",
          "prompt.id": "p_1",
          "event.name": "user_prompt",
          "event.sequence": "1",
        },
      };

      expect(synthesizeTraceContext(args)).toEqual(
        synthesizeTraceContext(args),
      );
    });
  });
});
