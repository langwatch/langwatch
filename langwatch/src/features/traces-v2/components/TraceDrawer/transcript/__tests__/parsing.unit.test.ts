import { describe, expect, it } from "vitest";
import {
  coerceToChatMessages,
  extractSystemText,
  parseContentBlocks,
} from "../parsing";

describe("coerceToChatMessages", () => {
  describe("given an explicit chat_messages typed-value envelope", () => {
    describe("when one message in the conversation is malformed", () => {
      it("trusts the declared type and returns the renderable messages", () => {
        const envelope = {
          type: "chat_messages",
          value: [
            { role: "user", content: "hello" },
            { role: "weird", contnet: "oops, typo'd key and odd role" },
            { role: "assistant", content: "hi there" },
          ],
        };

        const result = coerceToChatMessages(envelope);

        expect(result).not.toBeNull();
        // The malformed entry is still an object carrying a `role`, so the
        // lenient declared-envelope path keeps all three rather than dropping
        // the whole conversation to the raw-JSON fallback.
        expect(result).toHaveLength(3);
        expect(result?.[0]).toMatchObject({ role: "user", content: "hello" });
        expect(result?.[2]).toMatchObject({
          role: "assistant",
          content: "hi there",
        });
      });
    });

    describe("when the envelope contains non-object junk entries", () => {
      it("drops the non-objects and keeps the role/content-bearing messages", () => {
        const envelope = {
          type: "chat_messages",
          value: [
            "not a message",
            42,
            null,
            { content: "only content, no role" },
          ],
        };

        const result = coerceToChatMessages(envelope);

        expect(result).toHaveLength(1);
        expect(result?.[0]).toMatchObject({ content: "only content, no role" });
      });
    });

    describe("when no entry is a role/content-bearing object", () => {
      it("returns null because nothing renderable survives", () => {
        const envelope = {
          type: "chat_messages",
          value: ["nope", 1, null, { foo: "bar" }],
        };

        expect(coerceToChatMessages(envelope)).toBeNull();
      });
    });
  });

  describe("given a plain non-chat array (no declared type)", () => {
    describe("when a single entry is not a valid chat message", () => {
      it("stays strict and returns null", () => {
        const data = [
          { role: "user", content: "hello" },
          { role: "weird", content: "invalid role, not a chat message" },
        ];

        expect(coerceToChatMessages(data)).toBeNull();
      });
    });

    describe("when the array is not chat-shaped at all", () => {
      it("returns null", () => {
        expect(coerceToChatMessages([{ foo: 1 }, { bar: 2 }])).toBeNull();
        expect(coerceToChatMessages([1, 2, 3])).toBeNull();
      });
    });
  });

  describe("given a well-formed chat message array", () => {
    it("returns it unchanged", () => {
      const data = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ];

      expect(coerceToChatMessages(data)).toEqual(data);
    });
  });
});

describe("extractSystemText", () => {
  describe("given a chat array with a string system message", () => {
    it("returns the first system message's content", () => {
      const raw = JSON.stringify([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hi" },
        { role: "system", content: "second system, ignored" },
      ]);
      expect(extractSystemText(raw)).toBe("You are a helpful assistant.");
    });
  });

  describe("given a system message with typed text-block content", () => {
    it("joins the text blocks and unwraps them from the block envelope", () => {
      const raw = JSON.stringify([
        {
          role: "system",
          content: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" },
          ],
        },
      ]);
      expect(extractSystemText(raw)).toBe("line one\nline two");
    });
  });

  describe("given a chat_messages typed-value envelope", () => {
    it("reaches inside the envelope for the system prompt", () => {
      const raw = JSON.stringify({
        type: "chat_messages",
        value: [
          { role: "system", content: "enveloped system" },
          { role: "user", content: "hi" },
        ],
      });
      expect(extractSystemText(raw)).toBe("enveloped system");
    });
  });

  describe("given input with no system role", () => {
    it("returns an empty string", () => {
      const raw = JSON.stringify([
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ]);
      expect(extractSystemText(raw)).toBe("");
    });
  });

  describe("given non-chat input", () => {
    it("returns an empty string for plain prose", () => {
      expect(extractSystemText("just some plain text")).toBe("");
    });

    it("returns an empty string for null / empty input", () => {
      expect(extractSystemText(null)).toBe("");
      expect(extractSystemText(undefined)).toBe("");
      expect(extractSystemText("")).toBe("");
    });
  });
});

describe("parseContentBlocks", () => {
  describe("given an input_audio content part", () => {
    it("returns a single media block carrying the audio part", () => {
      const blocks = parseContentBlocks([
        {
          type: "input_audio",
          input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
        },
      ]);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        kind: "media",
        part: {
          type: "audio",
          source: {
            type: "url",
            value: "/api/files/p1/a1",
            mimeType: "audio/wav",
          },
        },
      });
    });
  });

  describe("given an audio source content part", () => {
    it("returns a single media block carrying the audio part", () => {
      const blocks = parseContentBlocks([
        {
          type: "audio",
          source: {
            type: "url",
            value: "https://cdn.example/a.wav",
            mimeType: "audio/wav",
          },
        },
      ]);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        kind: "media",
        part: { type: "audio" },
      });
    });
  });
});
