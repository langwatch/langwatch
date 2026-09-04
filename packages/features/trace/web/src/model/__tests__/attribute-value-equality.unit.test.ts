/**
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { describe, expect, it } from "vitest";
import { sameAttributeValue } from "../attribute-value-equality";

/** `gen_ai.input.messages` as the trace recorded it, trimmed to two turns. */
const MESSAGES = [
  { role: "system", content: "You are Langy, the LangWatch assistant." },
  {
    role: "user",
    content: [
      {
        text: "I want to see all of the off topic evaluator traces",
        type: "text",
      },
    ],
  },
];

/** `ai.response.toolCalls` as the trace recorded it. */
const TOOL_CALLS = [
  {
    type: "tool-call",
    input: {
      command:
        'langwatch trace search --query "off topic" --origin evaluation --limit 1 --format json',
      timeout: 120000,
      workdir: "/workspace/sessions/langyconv_0007F7chgdezG0kgTQDLy6Hqph7kf",
    },
    toolName: "bash",
    toolCallId: "call_VXJC9uzjpxa99ESxuMwQPEyF",
    providerMetadata: {
      openai: {
        itemId: "fc_0610d3aef2ce17a7016a79d1df6c108191985b164948aca4fb",
      },
    },
  },
];

/** The same object with its keys written in the opposite order. */
function withReversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withReversedKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, entry]) => [key, withReversedKeys(entry)]),
    );
  }
  return value;
}

describe("sameAttributeValue", () => {
  describe("given a value whose keys came back in another order", () => {
    describe("when it is compared with what was captured", () => {
      /** @scenario Reordered JSON keys are not an edit */
      it("reads them as the same value", () => {
        expect(sameAttributeValue(TOOL_CALLS, withReversedKeys(TOOL_CALLS))).toBe(true);
      });
    });
  });

  describe("given a value whose array entries came back in another order", () => {
    describe("when it is compared with what was captured", () => {
      /** @scenario Reordered JSON array entries are an edit */
      it("reads them as different values", () => {
        expect(sameAttributeValue(MESSAGES, [...MESSAGES].reverse())).toBe(false);
      });
    });
  });
});
