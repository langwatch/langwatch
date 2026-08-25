/**
 * The attribute values in here are real ones off a corrected trace: the tool
 * calls an assistant span recorded, and the conversation a span was given. They
 * are what a correction re-serialises without changing, which is what used to
 * light the "Edited" marker on rows nobody had edited.
 *
 * See specs/traces-v2/trace-edit-mode.feature.
 */
import { describe, expect, it } from "vitest";
import { sameAttributeValue } from "../attributeValueEquality";

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

/** The same value written out the way a re-serialisation writes it. */
const prettyPrinted = (value: unknown) => JSON.stringify(value, null, 2);

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
  describe("given a value a correction only re-serialised", () => {
    describe("when it is compared with what was captured", () => {
      /** @scenario "JSON that only changed its formatting is not marked as edited" */
      it("reads the tool calls as the same value", () => {
        expect(
          sameAttributeValue(JSON.stringify(TOOL_CALLS), prettyPrinted(TOOL_CALLS)),
        ).toBe(true);
      });

      /** @scenario "JSON that only changed its formatting is not marked as edited" */
      it("reads the conversation as the same value", () => {
        expect(
          sameAttributeValue(JSON.stringify(MESSAGES), prettyPrinted(MESSAGES)),
        ).toBe(true);
      });

      it("reads text and the structure it spells out as the same value", () => {
        expect(sameAttributeValue(JSON.stringify(TOOL_CALLS), TOOL_CALLS)).toBe(true);
      });
    });
  });

  describe("given a value whose keys came back in another order", () => {
    describe("when it is compared with what was captured", () => {
      /** @scenario "Reordered JSON keys are not an edit" */
      it("reads them as the same value", () => {
        expect(sameAttributeValue(TOOL_CALLS, withReversedKeys(TOOL_CALLS))).toBe(true);
      });
    });
  });

  describe("given a value whose array entries came back in another order", () => {
    describe("when it is compared with what was captured", () => {
      /** @scenario "Reordered JSON array entries are an edit" */
      it("reads them as different values", () => {
        expect(sameAttributeValue(MESSAGES, [...MESSAGES].reverse())).toBe(false);
      });
    });
  });

  describe("given a value the correction actually changed", () => {
    describe("when it is compared with what was captured", () => {
      it("reads a changed tool argument as a different value", () => {
        const edited = structuredClone(TOOL_CALLS);
        edited[0]!.input.command = "langwatch trace search --limit 5";

        expect(sameAttributeValue(TOOL_CALLS, edited)).toBe(false);
      });

      it("reads a dropped key as a different value", () => {
        const [first, ...rest] = structuredClone(TOOL_CALLS);
        const { providerMetadata: _dropped, ...withoutMetadata } = first!;

        expect(sameAttributeValue(TOOL_CALLS, [withoutMetadata, ...rest])).toBe(false);
      });

      it("reads text that only looks like a number as the text it is", () => {
        expect(sameAttributeValue("123", 123)).toBe(false);
      });

      it("reads text that never parsed as JSON by what it says", () => {
        expect(sameAttributeValue("gpt-5-mini", "gpt-5-mini")).toBe(true);
        expect(sameAttributeValue("gpt-5-mini", "gpt-5")).toBe(false);
      });

      it("reads text that opens like JSON but is not by what it says", () => {
        expect(sameAttributeValue("{not json", "{not json")).toBe(true);
        expect(sameAttributeValue("{not json", "{also not")).toBe(false);
      });
    });
  });
});
