/**
 * Ingest-time derivation of the useful content out of raw LLM API bodies.
 *
 * An emitter that logs its raw provider request/response ships a 60 KB JSON blob
 * per model call, and every consumer wants the same few things out of it. We
 * parse it ONCE here and stamp the result on the record, so reads are cheap and
 * the data becomes queryable as ordinary log attributes.
 */
import { describe, expect, it } from "vitest";
import {
  DERIVED_ATTRS,
  deriveLogContentAttributes,
} from "../log-content-derivation";

const CLAUDE_SCOPE = "com.anthropic.claude_code.events";

function derive(attributes: Record<string, string>, scopeName = CLAUDE_SCOPE) {
  return deriveLogContentAttributes({ scopeName, attributes });
}

const RESPONSE_BODY = JSON.stringify({
  id: "msg_1",
  stop_reason: "tool_use",
  content: [
    { type: "text", text: "Let me check the tests." },
    { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pnpm test" } },
    { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "a.ts" } },
  ],
});

describe("deriveLogContentAttributes", () => {
  describe("given an api_response_body", () => {
    const derived = derive({
      "event.name": "api_response_body",
      body: RESPONSE_BODY,
    });

    it("lifts the assistant's reply text", () => {
      expect(derived[DERIVED_ATTRS.OUTPUT_TEXT]).toBe("Let me check the tests.");
    });

    it("lifts which tools it called, so tool usage is queryable", () => {
      expect(JSON.parse(derived[DERIVED_ATTRS.OUTPUT_TOOL_CALLS] ?? "[]")).toEqual([
        { id: "toolu_1", name: "Bash" },
        { id: "toolu_2", name: "Read" },
      ]);
      expect(derived[DERIVED_ATTRS.OUTPUT_TOOL_CALL_COUNT]).toBe("2");
    });

    it("lifts why the model stopped", () => {
      expect(derived[DERIVED_ATTRS.STOP_REASON]).toBe("tool_use");
    });
  });

  describe("given an api_request_body", () => {
    it("lifts how much rolling history the call carried", () => {
      const derived = derive({
        "event.name": "api_request_body",
        body: JSON.stringify({
          model: "claude-opus-4-8",
          messages: [
            { role: "user", content: "hi" },
            { role: "assistant", content: "hello" },
          ],
        }),
      });

      expect(derived[DERIVED_ATTRS.INPUT_MESSAGE_COUNT]).toBe("2");
    });
  });

  describe("given a truncated body", () => {
    // Claude caps oversized bodies inline, which leaves invalid JSON. That is
    // expected, not exceptional — consumers keep their own fallbacks.
    it("derives nothing rather than throwing", () => {
      const truncated = RESPONSE_BODY.slice(0, 60);

      expect(() =>
        derive({ "event.name": "api_response_body", body: truncated }),
      ).not.toThrow();
    });
  });

  describe("given a record we have no derivation for", () => {
    it("derives nothing, so the common path pays nothing", () => {
      expect(derive({ "event.name": "user_prompt", prompt: "hi" })).toEqual({});
      expect(derive({ "event.name": "api_request", cost_usd: "0.1" })).toEqual({});
      expect(
        derive({ "event.name": "api_response_body", body: RESPONSE_BODY }, "some.other.scope"),
      ).toEqual({});
    });
  });
});
