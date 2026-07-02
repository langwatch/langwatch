import { describe, expect, it } from "vitest";
import { audioPartToMediaData, collectAudioParts } from "../audioParts";

describe("audioPartToMediaData", () => {
  describe("given an OpenAI input_audio part", () => {
    describe("when it carries an externalized url", () => {
      it("maps it to a url audio source", () => {
        expect(
          audioPartToMediaData({
            type: "input_audio",
            input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
          }),
        ).toEqual({
          type: "audio",
          source: {
            type: "url",
            value: "/api/files/p1/a1",
            mimeType: "audio/wav",
          },
        });
      });
    });

    describe("when it carries inline base64 data with a format", () => {
      it("maps it to a data audio source with the mime derived from format", () => {
        expect(
          audioPartToMediaData({
            type: "input_audio",
            input_audio: { data: "QUJD", format: "mp3" },
          }),
        ).toEqual({
          type: "audio",
          source: { type: "data", value: "QUJD", mimeType: "audio/mpeg" },
        });
      });
    });
  });

  describe("given an AG-UI audio part", () => {
    it("passes the url source through unchanged", () => {
      const part = {
        type: "audio",
        source: {
          type: "url",
          value: "https://cdn.example/a.wav",
          mimeType: "audio/wav",
        },
      };
      expect(audioPartToMediaData(part)).toEqual(part);
    });
  });

  describe("given a binary part", () => {
    describe("when the mimeType is audio", () => {
      it("passes it through as an audio-capable binary part", () => {
        expect(
          audioPartToMediaData({
            type: "binary",
            mimeType: "audio/wav",
            url: "/api/files/p1/a2",
          }),
        ).toEqual({
          type: "binary",
          mimeType: "audio/wav",
          url: "/api/files/p1/a2",
        });
      });
    });

    describe("when the mimeType is not audio", () => {
      it("returns null", () => {
        expect(
          audioPartToMediaData({
            type: "binary",
            mimeType: "image/png",
            url: "/api/files/p1/i1",
          }),
        ).toBeNull();
      });
    });
  });

  describe("given a non-audio content part", () => {
    it("returns null for text", () => {
      expect(audioPartToMediaData({ type: "text", text: "hi" })).toBeNull();
    });

    it("returns null for a tool call", () => {
      expect(
        audioPartToMediaData({ type: "tool_call", toolName: "x", args: "{}" }),
      ).toBeNull();
    });

    it("returns null for a tool result", () => {
      expect(
        audioPartToMediaData({ type: "tool_result", result: "x" }),
      ).toBeNull();
    });

    it("returns null for an image_url", () => {
      expect(
        audioPartToMediaData({
          type: "image_url",
          image_url: { url: "https://x/i.png" },
        }),
      ).toBeNull();
    });
  });
});

describe("collectAudioParts", () => {
  const audioPart = {
    type: "input_audio",
    input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
  };

  describe("given a bare content-part array", () => {
    it("finds the audio part among text siblings", () => {
      const parts = collectAudioParts([
        audioPart,
        { type: "text", text: "hi" },
      ]);
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ type: "audio" });
    });
  });

  describe("given a chat_messages typed-value envelope", () => {
    it("finds audio nested in a message's content array", () => {
      const value = {
        type: "chat_messages",
        value: [{ role: "user", content: [audioPart] }],
      };
      expect(collectAudioParts(value)).toHaveLength(1);
    });
  });

  describe("given a bare messages array", () => {
    it("finds audio inside a message's content", () => {
      const value = [{ role: "user", content: [audioPart] }];
      expect(collectAudioParts(value)).toHaveLength(1);
    });
  });

  describe("given a messages envelope object", () => {
    it("finds audio inside the messages field", () => {
      const value = { messages: [{ role: "user", content: [audioPart] }] };
      expect(collectAudioParts(value)).toHaveLength(1);
    });
  });

  describe("given a plain text payload", () => {
    it("returns an empty array", () => {
      expect(collectAudioParts("hello there")).toEqual([]);
      expect(collectAudioParts([{ type: "text", text: "hi" }])).toEqual([]);
      expect(
        collectAudioParts({ messages: [{ role: "user", content: "hi" }] }),
      ).toEqual([]);
    });
  });
});
