import { describe, expect, it } from "vitest";
import type { Span } from "~/server/tracer/types";
import { buildDisplayInput } from "../tracesV2";

type InputParts = Pick<Span, "input" | "params">;

const chat = (messages: unknown[]): InputParts["input"] =>
  ({ type: "chat_messages", value: messages }) as InputParts["input"];

describe("buildDisplayInput", () => {
  describe("given a chat-message input whose system prompt was canonicalised out", () => {
    describe("when the span carries gen_ai.system_instructions (flat key)", () => {
      it("prepends the system prompt as a leading system message", () => {
        const out = buildDisplayInput({
          input: chat([{ role: "user", content: "hi" }]),
          params: { "gen_ai.system_instructions": "be terse" },
        });
        expect(JSON.parse(out!)).toEqual([
          { role: "system", content: "be terse" },
          { role: "user", content: "hi" },
        ]);
      });
    });

    describe("when the instructions live under a nested gen_ai object", () => {
      it("reads the nested shape and prepends the system message", () => {
        const out = buildDisplayInput({
          input: chat([{ role: "user", content: "hi" }]),
          params: { gen_ai: { system_instructions: "nested rules" } },
        });
        expect(JSON.parse(out!)[0]).toEqual({
          role: "system",
          content: "nested rules",
        });
      });
    });
  });

  describe("given a chat-message input that already has its own system message", () => {
    it("does not prepend a duplicate", () => {
      const out = buildDisplayInput({
        input: chat([
          { role: "system", content: "already here" },
          { role: "user", content: "hi" },
        ]),
        params: { "gen_ai.system_instructions": "be terse" },
      });
      const parsed = JSON.parse(out!);
      expect(parsed.filter((m: { role: string }) => m.role === "system")).toEqual(
        [{ role: "system", content: "already here" }],
      );
    });
  });

  describe("given a span with no system instructions", () => {
    it("returns the chat transcript unchanged", () => {
      const out = buildDisplayInput({
        input: chat([{ role: "user", content: "hi" }]),
        params: { "gen_ai.operation.name": "chat" },
      });
      expect(JSON.parse(out!)).toEqual([{ role: "user", content: "hi" }]);
    });

    it("ignores blank instruction strings", () => {
      const out = buildDisplayInput({
        input: chat([{ role: "user", content: "hi" }]),
        params: { "gen_ai.system_instructions": "   " },
      });
      expect(JSON.parse(out!)).toEqual([{ role: "user", content: "hi" }]);
    });
  });

  describe("given non-chat input", () => {
    it("leaves a plain text input untouched even with system instructions", () => {
      const out = buildDisplayInput({
        input: { type: "text", value: "raw prompt" } as InputParts["input"],
        params: { "gen_ai.system_instructions": "be terse" },
      });
      expect(out).toBe("raw prompt");
    });
  });
});
