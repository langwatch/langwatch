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

    describe("when it carries a container format like wav", () => {
      it("passes the bytes through unwrapped (must stay playable as-is)", () => {
        // Guards the browser-QA-proven path: a `wav` turn is already a valid
        // container, so it must NOT be re-wrapped — the value stays identical.
        expect(
          audioPartToMediaData({
            type: "input_audio",
            input_audio: { data: "QUJD", format: "wav" },
          }),
        ).toEqual({
          type: "audio",
          source: { type: "data", value: "QUJD", mimeType: "audio/wav" },
        });
      });
    });

    describe("when it carries raw header-less pcm16 data", () => {
      it("wraps the raw pcm16 in a WAV container so it is playable", () => {
        // 4 raw little-endian int16 samples — no RIFF header.
        const pcm = new Uint8Array([
          0x00, 0x00, 0x10, 0x20, 0xff, 0x7f, 0x00, 0x80,
        ]);
        const result = audioPartToMediaData({
          type: "input_audio",
          input_audio: {
            data: Buffer.from(pcm).toString("base64"),
            format: "pcm16",
          },
        });

        expect(result).not.toBeNull();
        const source = (
          result as {
            source: { type: string; value: string; mimeType?: string };
          }
        ).source;
        expect(source.type).toBe("data");
        expect(source.mimeType).toBe("audio/wav");

        // The value must now be a real WAV: RIFF/WAVE magic, 24 kHz mono
        // 16-bit, with the original PCM bytes appended after the 44-byte header.
        const wav = Buffer.from(source.value, "base64");
        expect(wav.length).toBe(44 + pcm.length);
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
        expect(wav.readUInt16LE(20)).toBe(1); // audioFormat = PCM
        expect(wav.readUInt16LE(22)).toBe(1); // mono
        expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
        expect(wav.readUInt16LE(34)).toBe(16); // bits per sample
        expect(Buffer.from(wav.subarray(44)).equals(Buffer.from(pcm))).toBe(
          true,
        );
      });
    });

    describe("when it carries companded g711 data", () => {
      it("returns null rather than a silently-broken player", () => {
        // Raw g711 can't be wrapped inline yet; emitting an <audio> would be a
        // dead player, so it must fall back (null) to the raw view instead.
        expect(
          audioPartToMediaData({
            type: "input_audio",
            input_audio: { data: "AAAA", format: "g711_ulaw" },
          }),
        ).toBeNull();
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

    describe("when it carries an inline data source with no mimeType", () => {
      it("defaults the data-source mimeType so the data: URI is valid", () => {
        const result = audioPartToMediaData({
          type: "audio",
          source: { type: "data", value: "QUJD" },
        });

        expect(result).toEqual({
          type: "audio",
          source: { type: "data", value: "QUJD", mimeType: "audio/wav" },
        });
        // The whole point: without a default this is `data:undefined;base64,…`
        // — a broken player. The mimeType must be defined, not undefined.
        const source = (result as { source: { mimeType?: string } }).source;
        expect(source.mimeType).toBeDefined();
        expect(source.mimeType).toBe("audio/wav");
      });
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

  describe("given a bare audio object with no envelope", () => {
    it("finds an audio part that is the root object itself", () => {
      // A span whose entire input/output is one audio part, not wrapped in a
      // messages/content envelope — previously yielded no player.
      const parts = collectAudioParts(audioPart);
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
