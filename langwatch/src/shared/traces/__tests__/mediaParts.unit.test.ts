import { describe, expect, it } from "vitest";
import {
  audioPartToMediaData,
  collectAudioParts,
  collectMediaParts,
  isSafeMediaUrl,
  mediaPartToMediaData,
} from "../mediaParts";

describe("isSafeMediaUrl", () => {
  /** @scenario A scripted URL in span content never reaches an anchor or element */
  it("rejects scripted, protocol-relative, and traversal urls", () => {
    expect(isSafeMediaUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeMediaUrl("JavaScript:alert(1)")).toBe(false);
    // Browsers strip control chars when parsing an href, so a split scheme
    // still executes — the check must survive that.
    expect(isSafeMediaUrl("java\tscript:alert(1)")).toBe(false);
    expect(isSafeMediaUrl("java\nscript:alert(1)")).toBe(false);
    expect(isSafeMediaUrl(" javascript:alert(1)")).toBe(false);
    expect(isSafeMediaUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeMediaUrl("blob:https://app/id")).toBe(false);
    expect(isSafeMediaUrl("//attacker.example/x.png")).toBe(false);
    expect(isSafeMediaUrl("/api/files/../../auth/session")).toBe(false);
    expect(isSafeMediaUrl("relative/path.png")).toBe(false);
  });

  it("accepts stored-object references, data URIs, and absolute http(s)", () => {
    expect(isSafeMediaUrl("/api/files/p1/obj1")).toBe(true);
    expect(isSafeMediaUrl("data:image/png;base64,QUJD")).toBe(true);
    expect(isSafeMediaUrl("https://cdn.example/i.png")).toBe(true);
    expect(isSafeMediaUrl("http://cdn.example/i.png")).toBe(true);
  });
});

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
      it("decodes it to a playable linear-PCM WAV data source", () => {
        // Browser WAV playback is PCM-only, so the companded bytes are
        // expanded during the wrap instead of shipped under fmt codes 6/7.
        const result = audioPartToMediaData({
          type: "input_audio",
          input_audio: { data: "AAAA", format: "g711_ulaw" },
        });

        expect(result).not.toBeNull();
        const source = (
          result as { source: { value: string; mimeType?: string } }
        ).source;
        expect(source.mimeType).toBe("audio/wav");
        const wav = Buffer.from(source.value, "base64");
        expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
        expect(wav.readUInt16LE(20)).toBe(1); // linear PCM after decode
        expect(wav.readUInt32LE(24)).toBe(8000);
        // 3 companded bytes ("AAAA" decodes to 3 bytes) → 3 PCM16 samples
        expect(wav.length).toBe(44 + 3 * 2);
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

describe("mediaPartToMediaData", () => {
  describe("given an image_url part", () => {
    it("maps externalized and data-URI urls to an image source", () => {
      expect(
        mediaPartToMediaData({
          type: "image_url",
          image_url: { url: "/api/files/p1/i1" },
        }),
      ).toEqual({
        type: "image",
        source: { type: "url", value: "/api/files/p1/i1" },
      });
    });
  });

  describe("given a binary attachment part", () => {
    it("passes a PDF reference through as a chip-renderable binary", () => {
      const part = {
        type: "binary",
        mimeType: "application/pdf",
        url: "/api/files/p1/f1",
        filename: "report.pdf",
      };
      expect(mediaPartToMediaData(part)).toEqual(part);
    });

    it("returns null for a binary with no payload at all", () => {
      expect(
        mediaPartToMediaData({ type: "binary", mimeType: "application/pdf" }),
      ).toBeNull();
    });
  });

  describe("given an AG-UI document part", () => {
    it("maps a url source to an attachment binary", () => {
      expect(
        mediaPartToMediaData({
          type: "document",
          source: {
            type: "url",
            value: "/api/files/p1/d1",
            mimeType: "application/pdf",
          },
        }),
      ).toEqual({
        type: "binary",
        mimeType: "application/pdf",
        url: "/api/files/p1/d1",
      });
    });
  });

  describe("given an AG-UI video part", () => {
    it("passes the url source through as video", () => {
      const part = {
        type: "video",
        source: {
          type: "url",
          value: "/api/files/p1/v1",
          mimeType: "video/mp4",
        },
      };
      expect(mediaPartToMediaData(part)).toEqual(part);
    });
  });
});

describe("collectMediaParts", () => {
  const imagePart = {
    type: "image_url",
    image_url: { url: "/api/files/p1/i1" },
  };
  const pdfPart = {
    type: "binary",
    mimeType: "application/pdf",
    url: "/api/files/p1/f1",
    filename: "report.pdf",
  };

  describe("given messages carrying an image and a pdf", () => {
    it("collects both media kinds", () => {
      const value = [
        { role: "user", content: [imagePart, { type: "text", text: "hi" }] },
        { role: "assistant", content: [pdfPart] },
      ];
      const parts = collectMediaParts(value);
      expect(parts).toHaveLength(2);
      expect(parts[0]).toMatchObject({ type: "image" });
      expect(parts[1]).toMatchObject({
        type: "binary",
        filename: "report.pdf",
      });
    });
  });

  describe("given a typed-raw envelope whose value is a JSON string", () => {
    it("parses through the nested string and finds the media", () => {
      const value = {
        type: "raw",
        value: JSON.stringify([{ role: "user", content: [imagePart] }]),
      };
      expect(collectMediaParts(value)).toHaveLength(1);
    });
  });

  describe("given external http media of every category", () => {
    /** @scenario External http(s) media is not auto-mounted from collected content */
    it("does not surface any of them as collected inline media", () => {
      // External links stay links — collecting them would auto-fetch
      // third-party content on every trace open, for players and chips just
      // as much as for <img>.
      const value = [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "https://cdn.example/i.png" },
            },
            {
              type: "binary",
              mimeType: "image/png",
              url: "https://attacker.example/beacon.png",
            },
            {
              type: "audio",
              source: { type: "url", value: "https://attacker.example/a.wav" },
            },
            {
              type: "video",
              source: { type: "url", value: "https://attacker.example/v.mp4" },
            },
          ],
        },
      ];
      expect(collectMediaParts(value)).toEqual([]);
    });
  });

  describe("given a scripted url smuggled as an attachment part", () => {
    /** @scenario A scripted URL in span content never reaches an anchor or element */
    it("drops the part instead of collecting a chip", () => {
      const value = [
        {
          role: "user",
          content: [
            {
              type: "binary",
              mimeType: "application/pdf",
              filename: "invoice.pdf",
              url: "javascript:alert(document.cookie)",
            },
          ],
        },
      ];
      expect(collectMediaParts(value)).toEqual([]);
    });
  });

  describe("given a bare string that is one media reference", () => {
    it("surfaces a whole-value data URI as renderable media", () => {
      const parts = collectMediaParts("data:image/png;base64,QUJD");
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({ type: "image" });
    });

    it("surfaces a whole-value stored-object url as an attachment chip", () => {
      const parts = collectMediaParts("/api/files/p1/obj1");
      expect(parts).toHaveLength(1);
      expect(parts[0]).toMatchObject({
        type: "binary",
        url: "/api/files/p1/obj1",
      });
    });

    it("ignores prose that merely mentions a reference", () => {
      expect(
        collectMediaParts("see the file at /api/files/p1/obj1 for details"),
      ).toEqual([]);
    });
  });

  describe("given a binary part with only an id", () => {
    it("returns null instead of a chip with nothing to open", () => {
      // An id-only reference has no fetchable payload: src/href would
      // resolve to "" — the current document URL.
      expect(
        mediaPartToMediaData({
          type: "binary",
          mimeType: "application/pdf",
          id: "obj1",
        }),
      ).toBeNull();
    });
  });

  describe("given an image part with an inline data source and no mimeType", () => {
    it("defaults to an image mime so the data URI renders", () => {
      const result = mediaPartToMediaData({
        type: "image",
        source: { type: "data", value: "QUJD" },
      });
      expect(result).toEqual({
        type: "image",
        source: { type: "data", value: "QUJD", mimeType: "image/png" },
      });
    });
  });

  describe("given media nested deeper than the fixed envelope keys", () => {
    it("still finds a part under an arbitrary key (generic recursion)", () => {
      // The collector recurses every object key like the extraction walker,
      // not a fixed envelope list — a part the extractor externalized under
      // an unusual key must still render.
      const value = {
        result: {
          artifacts: [
            {
              type: "image_url",
              image_url: { url: "/api/files/p1/i9" },
            },
          ],
        },
      };
      expect(collectMediaParts(value)).toHaveLength(1);
    });
  });
});
