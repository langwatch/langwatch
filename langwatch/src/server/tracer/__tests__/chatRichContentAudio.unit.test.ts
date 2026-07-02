/**
 * @vitest-environment node
 *
 * Unit tests for the audio members of `chatRichContentSchema` (#5304).
 * Feature: specs/trace-processing/audio-player-in-traces.feature
 */
import { describe, expect, it } from "vitest";
import { chatRichContentSchema } from "../types";

describe("chatRichContentSchema", () => {
  describe("given an OpenAI input_audio part", () => {
    describe("when it is the pre-extraction inline shape", () => {
      it("accepts data + format", () => {
        const part = {
          type: "input_audio",
          input_audio: { data: "QUJD", format: "wav" },
        };
        expect(chatRichContentSchema.parse(part)).toEqual(part);
      });
    });

    describe("when it is the post-extraction reference shape", () => {
      it("accepts url + mimeType", () => {
        const part = {
          type: "input_audio",
          input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
        };
        expect(chatRichContentSchema.parse(part)).toEqual(part);
      });
    });
  });

  describe("given an AG-UI audio source part", () => {
    it("accepts a url source with a mimeType", () => {
      const part = {
        type: "audio",
        source: {
          type: "url",
          value: "https://cdn.example/a.wav",
          mimeType: "audio/wav",
        },
      };
      expect(chatRichContentSchema.parse(part)).toEqual(part);
    });
  });

  describe("given the pre-existing content shapes", () => {
    it("still accepts a text part", () => {
      const part = { type: "text", text: "hello" };
      expect(chatRichContentSchema.parse(part)).toEqual(part);
    });

    it("still accepts a binary part", () => {
      const part = {
        type: "binary",
        mimeType: "audio/wav",
        url: "/api/files/p1/a2",
      };
      expect(chatRichContentSchema.parse(part)).toEqual(part);
    });
  });
});
