/**
 * Attribute corrections can re-serialise JSON without changing its meaning.
 * Key order is formatting; array order and scalar type are content.
 */
import { describe, expect, it } from "vitest";
import { sameAttributeValue } from "../attribute-value-equality";

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

const MESSAGES = [
  { role: "system", content: "You are Langy, the LangWatch assistant." },
  {
    role: "user",
    content: [{ text: "I want to see all of the off topic evaluator traces", type: "text" }],
  },
];

const prettyPrinted = (value: unknown) => JSON.stringify(value, null, 2);

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
  it("ignores JSON formatting and key order", () => {
    expect(sameAttributeValue(JSON.stringify(TOOL_CALLS), prettyPrinted(TOOL_CALLS))).toBe(true);
    expect(sameAttributeValue(TOOL_CALLS, withReversedKeys(TOOL_CALLS))).toBe(true);
    expect(sameAttributeValue(JSON.stringify(TOOL_CALLS), TOOL_CALLS)).toBe(true);
  });

  it("preserves meaningful array and scalar changes", () => {
    expect(sameAttributeValue(MESSAGES, [...MESSAGES].reverse())).toBe(false);

    const edited = structuredClone(TOOL_CALLS);
    edited[0]!.input.command = "langwatch trace search --limit 5";
    expect(sameAttributeValue(TOOL_CALLS, edited)).toBe(false);
    expect(sameAttributeValue("123", 123)).toBe(false);
    expect(sameAttributeValue("gpt-5-mini", "gpt-5-mini")).toBe(true);
    expect(sameAttributeValue("{not json", "{also not")).toBe(false);
  });
});
