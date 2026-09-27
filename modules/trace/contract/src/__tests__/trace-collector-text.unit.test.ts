/**
 * The text a trace's JSON input or output reads as: the special keys each framework
 * writes, the chat-message shapes, and the values that stay unserializable.
 */
import { describe, expect, it } from "vitest";

import { typedValueToText } from "../trace-collector-common.ts";
import type { TypedValueJson } from "../trace-format.schemas.ts";

const JSON_CASES: readonly [
  name: string,
  value: TypedValueJson["value"],
  last: boolean,
  text: string,
][] = [
  ["a special text key", { text: "hi" }, false, "hi"],
  ["the first non-empty special key", { input: "", answer: "ans" }, false, "ans"],
  [
    "a message object, skipped for the next key",
    { message: { role: "user" }, output: "out" },
    false,
    "out",
  ],
  ["a Flowise last message", { messages: [{ content: "flow" }] }, false, "flow"],
  ["a LangChain wrapper keeping an empty input", { inputs: { input: "" } }, false, ""],
  ["LLM replies", { llm: { replies: ["r1"] } }, false, "r1"],
  [
    "a Langgraph AI message",
    { messages: [{ id: ["AIMessage"], kwargs: { content: "lg" } }] },
    false,
    "lg",
  ],
  ["the Optimization Studio end node", { end: { output: "e" } }, false, "e"],
  ["a single key's special text", { single: { text: "inner" } }, false, "inner"],
  ["an unmapped object, as JSON", { a: 1, b: 2 }, false, '{"a":1,"b":2}'],
  [
    "the last chat message's content blocks",
    [{ role: "user", content: [{ type: "text", text: "x" }, { content: "y" }] }],
    true,
    "xy",
  ],
  ["null", null, false, "[unserializable value]"],
  ["an end node that is null", { end: null }, false, "[unserializable value]"],
];

describe("typedValueToText", () => {
  describe("when a JSON value is read as text", () => {
    it.each(JSON_CASES)("reads %s", (_name, value, last, text) => {
      expect(typedValueToText({ type: "json", value }, last)).toBe(text);
    });
  });
});
