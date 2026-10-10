import { describe, expect, it } from "vitest";

import { splitChatForPanel } from "../split-chat-for-panel.ts";
import type { ChatMessage } from "../types.ts";

const roles = (messages: ChatMessage[]): string[] => messages.map((m) => m.role);

describe("splitChatForPanel", () => {
  describe("given a payload ending in a run of assistant messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "be helpful" },
      { role: "user", content: "what is the weather" },
      { role: "assistant", content: "let me check" },
      { role: "user", content: "thanks" },
      { role: "assistant", content: "it is raining" },
      { role: "assistant", content: "bring an umbrella" },
    ];

    /** @scenario "The input side is the history without this turn's reply" */
    it("drops the trailing assistant run for the input side", () => {
      expect(roles(splitChatForPanel({ messages, panel: "input" }))).toEqual([
        "system",
        "user",
        "assistant",
        "user",
      ]);
    });

    /** @scenario "The input side is the history without this turn's reply" */
    it("keeps prior assistant operations that are not the trailing run", () => {
      const kept = splitChatForPanel({ messages, panel: "input" });
      expect(kept).toContainEqual({
        role: "assistant",
        content: "let me check",
      });
    });
  });

  describe("given a payload whose last text-bearing user message is followed by tool work", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "run the tests" },
      {
        role: "assistant",
        content: [
          { type: "thinking", text: "I should run them" },
          { type: "tool_use", name: "bash", input: { cmd: "pnpm test" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", content: "3 failed" }],
      },
      { role: "assistant", content: "three tests failed" },
    ];

    /** @scenario "The output side starts at the last request the user made in words" */
    it("keeps everything after that user message, tool work included", () => {
      const kept = splitChatForPanel({ messages, panel: "output" });
      expect(kept).toHaveLength(3);
      expect(roles(kept)).toEqual(["assistant", "user", "assistant"]);
      expect(kept[2]).toEqual({
        role: "assistant",
        content: "three tests failed",
      });
    });

    /** @scenario "The output side starts at the last request the user made in words" */
    it("does not treat a tool-result-only user message as the request", () => {
      const kept = splitChatForPanel({ messages, panel: "output" });
      // The tool_result-carrying user message is inside the response, which
      // only holds if it was not mistaken for the last text-bearing request.
      expect(kept.some((m) => Array.isArray(m.content))).toBe(true);
    });
  });

  describe("given a payload carrying only an assistant reply", () => {
    /** @scenario "A payload with no text-bearing user message is returned whole" */
    it("returns the whole payload for the output side", () => {
      const messages: ChatMessage[] = [{ role: "assistant", content: "the answer" }];
      expect(splitChatForPanel({ messages, panel: "output" })).toEqual(messages);
    });

    it("returns nothing for the input side, since it is all reply", () => {
      const messages: ChatMessage[] = [{ role: "assistant", content: "the answer" }];
      expect(splitChatForPanel({ messages, panel: "input" })).toEqual([]);
    });
  });

  describe("given an empty payload", () => {
    it("returns nothing on either side", () => {
      expect(splitChatForPanel({ messages: [], panel: "input" })).toEqual([]);
      expect(splitChatForPanel({ messages: [], panel: "output" })).toEqual([]);
    });
  });
});
