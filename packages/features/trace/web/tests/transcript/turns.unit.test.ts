/**
 * @vitest-environment node
 *
 * Unit tests for grouping chat messages into conversation turns
 * (specs/traces-v2/media-rendering.feature: a message carrying only media is
 * still the user speaking).
 */
import { describe, expect, it } from "vitest";
import { groupMessagesIntoTurns } from "../../src/transcript/turns";
import type { ChatMessage } from "../../src/transcript/types";

const kindsOf = (messages: ChatMessage[]) =>
  groupMessagesIntoTurns(messages).map((turn) => turn.kind);

describe("groupMessagesIntoTurns", () => {
  describe("given a user message whose only content is an image", () => {
    /** @scenario A message carrying only media is still the user speaking */
    it("keeps it a user turn", () => {
      const turns = groupMessagesIntoTurns([
        { role: "system", content: "You are the pizza delivery guy" },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "/api/files/p1/i1" } }],
        },
      ]);

      expect(turns.map((turn) => turn.kind)).toEqual(["system", "user"]);
      expect(turns[1]?.blocks).toEqual([
        { kind: "media", part: expect.objectContaining({ type: "image" }) },
      ]);
    });
  });

  describe("given a user message whose only content is a recording", () => {
    it("keeps it a user turn", () => {
      expect(
        kindsOf([
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
              },
            ],
          },
          { role: "assistant", content: "I heard you" },
        ]),
      ).toEqual(["user", "assistant"]);
    });
  });

  describe("given a user message carrying an image next to its text", () => {
    it("keeps it a single user turn", () => {
      const turns = groupMessagesIntoTurns([
        {
          role: "user",
          content: [
            { type: "text", text: "what is this?" },
            { type: "image_url", image_url: { url: "/api/files/p1/i1" } },
          ],
        },
      ]);

      expect(turns).toHaveLength(1);
      expect(turns[0]?.kind).toBe("user");
      expect(turns[0]?.blocks).toHaveLength(2);
    });
  });

  describe("given a tool result echoed back through the user role", () => {
    /** @scenario A tool result echoed through the user role still folds into the assistant chain */
    it("folds it into the preceding assistant turn", () => {
      const turns = groupMessagesIntoTurns([
        { role: "user", content: "list the files" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "t1", name: "ls", input: { path: "." } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt" }],
        },
      ]);

      expect(turns.map((turn) => turn.kind)).toEqual(["user", "assistant"]);
      expect(turns[1]?.blocks.map((block) => block.kind)).toEqual(["tool_use", "tool_result"]);
    });
  });

  describe("given reasoning mislabelled under the user role", () => {
    it("still folds into the assistant chain", () => {
      expect(
        kindsOf([
          { role: "assistant", content: "thinking about it" },
          {
            role: "user",
            content: [{ type: "thinking", thinking: "still working" }],
          },
        ]),
      ).toEqual(["assistant"]);
    });
  });

  describe("given two user messages in a row", () => {
    it("keeps them as two beats", () => {
      expect(
        kindsOf([
          { role: "user", content: "hello" },
          { role: "user", content: "are you there?" },
        ]),
      ).toEqual(["user", "user"]);
    });
  });
});
