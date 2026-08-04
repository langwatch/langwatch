import { describe, expect, it } from "vitest";
import {
  applyChatTextLeaves,
  coerceToChatMessages,
  collectChatTextLeaves,
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

  describe("given an AI-SDK file audio content part", () => {
    it("returns a media block so traces-v2 matches the legacy player path", () => {
      const blocks = parseContentBlocks([
        { type: "file", mediaType: "audio/wav", data: "QUJD" },
      ]);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        kind: "media",
        part: {
          type: "audio",
          source: { type: "data", mimeType: "audio/wav" },
        },
      });
    });
  });

  describe("given a non-audio file content part", () => {
    it("renders it as an attachment media block instead of raw JSON", () => {
      const blocks = parseContentBlocks([
        { type: "file", mediaType: "application/pdf", data: "QUJD" },
      ]);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        kind: "media",
        part: { type: "binary", mimeType: "application/pdf" },
      });
    });
  });

  describe("given image and externalized binary content parts", () => {
    it("maps an externalized image_url reference to an image media block", () => {
      const blocks = parseContentBlocks([
        { type: "image_url", image_url: { url: "/api/files/p1/i1" } },
      ]);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        kind: "media",
        part: {
          type: "image",
          source: { type: "url", value: "/api/files/p1/i1" },
        },
      });
    });

    it("maps an externalized binary PDF reference to an attachment media block", () => {
      const blocks = parseContentBlocks([
        {
          type: "binary",
          mimeType: "application/pdf",
          url: "/api/files/p1/f1",
          filename: "report.pdf",
        },
      ]);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        kind: "media",
        part: { type: "binary", filename: "report.pdf" },
      });
    });
  });
});

describe("chat text leaves (translation splice)", () => {
  describe("given a conversation mixing prose, text parts and tool blocks", () => {
    const messages = [
      { role: "user", content: "Hej världen" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Det regnar" },
          { type: "tool_use", id: "t1", name: "get_weather", input: { q: 1 } },
        ],
      },
      {
        role: "user",
        content: '{"type":"tool_result","tool_use_id":"t1","content":"12C"}',
      },
    ];

    it("collects only the prose leaves, never roles or tool payloads", () => {
      expect(collectChatTextLeaves(messages)).toEqual({
        "0": "Hej världen",
        "1.0": "Det regnar",
      });
    });

    it("splices translations back so the result still coerces to the same chat", () => {
      const translated = applyChatTextLeaves(messages, {
        "0": "Hello world",
        "1.0": "It is raining",
      });

      const coerced = coerceToChatMessages(
        JSON.parse(JSON.stringify(translated)),
      );
      expect(coerced).toHaveLength(3);
      expect(coerced?.[0]).toMatchObject({
        role: "user",
        content: "Hello world",
      });
      expect(coerced?.[1]).toMatchObject({
        role: "assistant",
        content: [
          { type: "text", text: "It is raining" },
          { type: "tool_use", id: "t1", name: "get_weather", input: { q: 1 } },
        ],
      });
      // The tool_result message had no prose leaf — untouched.
      expect(coerced?.[2]).toEqual(messages[2]);
    });

    it("leaves the original messages unmutated", () => {
      applyChatTextLeaves(messages, { "0": "Hello world" });
      expect(messages[0]!.content).toBe("Hej världen");
    });
  });
});
