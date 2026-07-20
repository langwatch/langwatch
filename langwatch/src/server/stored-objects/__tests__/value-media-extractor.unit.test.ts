/**
 * @vitest-environment node
 *
 * Unit tests for the generic value media walker
 * (specs/trace-processing/trace-media-blob-extraction.feature — marker gate,
 * shape coverage, identity preservation, depth capping).
 *
 * A fake StoredObjectsService records every storeFromBytes call and returns
 * deterministic ids; the walker, the visitor dispatch, and the per-part
 * rewriting are the production code.
 */

import { describe, expect, it, vi } from "vitest";
import { containsMediaMarkers } from "~/shared/content-parts/media-markers";
import type { StoredObjectsService } from "../stored-objects.service";
import {
  createExtractionBudget,
  extractInlineMediaFromValue,
  MAX_MEDIA_PARTS_PER_SPAN,
} from "../value-media-extractor";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: vi.fn() };
      return (fn as (s: typeof span) => Promise<unknown>)(span);
    },
  }),
}));

vi.mock("~/server/metrics", () => ({
  getStoredObjectExtractCounter: () => ({ inc: vi.fn() }),
  getStoredObjectDedupHitCounter: () => ({ inc: vi.fn() }),
  getStoredObjectWriteFailureCounter: () => ({ inc: vi.fn() }),
  getStoredObjectSizeBytesHistogram: () => ({ observe: vi.fn() }),
  storedObjectReadFailureCounter: { inc: vi.fn() },
}));

interface StoredCall {
  mediaType: string;
  bytes: Buffer;
}

function makeFakeService(): {
  service: StoredObjectsService;
  calls: StoredCall[];
} {
  const calls: StoredCall[] = [];
  const service = {
    storeFromBytes: async ({
      mediaType,
      bytes,
    }: {
      mediaType: string;
      bytes: Buffer;
    }) => {
      calls.push({ mediaType, bytes });
      return {
        id: `so-${calls.length}`,
        mediaType,
        isDuplicate: false,
      };
    },
  } as unknown as StoredObjectsService;
  return { service, calls };
}

const PARAMS = {
  projectId: "proj-1",
  purpose: "trace_content",
  ownerKind: "trace",
  ownerId: "trace-1",
};

const AUDIO_B64 = Buffer.from("fake-pcm-bytes-0123456789").toString("base64");

describe("containsMediaMarkers", () => {
  it("matches the content-part vocabulary in compact and spaced JSON", () => {
    expect(
      containsMediaMarkers(`{"type":"file","mediaType":"audio/wav"}`),
    ).toBe(true);
    // Python json.dumps default separators put a space after the colon
    expect(
      containsMediaMarkers(`{"type": "file", "mediaType": "audio/wav"}`),
    ).toBe(true);
    expect(containsMediaMarkers(`{"type":"input_audio"}`)).toBe(true);
    expect(
      containsMediaMarkers(`{"type":"binary","mimeType":"application/pdf"}`),
    ).toBe(true);
    expect(containsMediaMarkers(`data:image/png;base64,AAAA`)).toBe(true);
    expect(containsMediaMarkers(`{"file":{"file_data":"..."}}`)).toBe(true);
  });

  it("matches parts nested inside escaped JSON strings (typed-raw envelopes)", () => {
    const inner = JSON.stringify([
      {
        role: "user",
        content: [{ type: "file", mediaType: "audio/pcm16", data: "AAAA" }],
      },
    ]);
    const outer = JSON.stringify({ type: "raw", value: inner });
    expect(containsMediaMarkers(outer)).toBe(true);
    // and one more nesting level (escaped twice)
    expect(containsMediaMarkers(JSON.stringify({ value: outer }))).toBe(true);
  });

  it("rejects plain text and ordinary JSON", () => {
    expect(containsMediaMarkers("a plain sentence about audio files")).toBe(
      false,
    );
    expect(containsMediaMarkers(`{"type":"text","text":"hello"}`)).toBe(false);
    expect(containsMediaMarkers(`{"temperature":0.2,"messages":[]}`)).toBe(
      false,
    );
  });
});

describe("extractInlineMediaFromValue", () => {
  describe("given a message array with an AI-SDK audio file part", () => {
    it("rewrites the part to an externalized input_audio reference", async () => {
      const { service, calls } = makeFakeService();
      const value = [
        {
          role: "user",
          content: [
            { type: "text", text: "hi" },
            { type: "file", mediaType: "audio/pcm16", data: AUDIO_B64 },
          ],
        },
      ];

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.refs).toHaveLength(1);
      // Raw pcm16 is WAV-wrapped at store time so the reference is playable.
      expect(calls[0]!.mediaType).toBe("audio/wav");
      expect(calls[0]!.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      const messages = result.value as Array<{
        content: Array<Record<string, unknown>>;
      }>;
      const part = messages[0]!.content[1]! as {
        type: string;
        input_audio: { url: string; data?: string };
      };
      expect(part.type).toBe("input_audio");
      expect(part.input_audio.url).toBe("/api/files/proj-1/so-1");
      expect(part.input_audio.data).toBeUndefined();
      // Untouched sibling part keeps reference identity
      expect(messages[0]!.content[0]).toBe(value[0]!.content[0]);
    });
  });

  describe("given a nested JSON string carrying media", () => {
    it("parses through the string and re-serializes only when changed", async () => {
      const { service } = makeFakeService();
      const inner = JSON.stringify([
        {
          role: "user",
          content: [{ type: "file", mediaType: "audio/wav", data: AUDIO_B64 }],
        },
      ]);
      const value = { type: "raw", value: inner };

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.refs).toHaveLength(1);
      const envelope = result.value as { type: string; value: string };
      expect(envelope.type).toBe("raw");
      const reparsed = JSON.parse(envelope.value) as Array<{
        content: Array<{ type: string }>;
      }>;
      expect(reparsed[0]!.content[0]!.type).toBe("input_audio");
    });

    it("keeps a marker-free nested string byte-identical", async () => {
      const { service, calls } = makeFakeService();
      const inner = JSON.stringify([
        { role: "user", content: "no media here" },
      ]);
      const value = { type: "raw", value: inner };

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.value).toBe(value);
      expect(calls).toHaveLength(0);
    });
  });

  describe("given media nested inside a tool result", () => {
    it("finds and rewrites the part at depth", async () => {
      const { service } = makeFakeService();
      const value = [
        {
          role: "tool",
          content: [
            {
              type: "tool_result",
              result: {
                screenshots: [
                  {
                    type: "image_url",
                    image_url: { url: `data:image/png;base64,${AUDIO_B64}` },
                  },
                ],
              },
            },
          ],
        },
      ];

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.refs).toHaveLength(1);
      const rewritten = result.value as Array<{
        content: Array<{
          result: { screenshots: Array<{ image_url: { url: string } }> };
        }>;
      }>;
      expect(
        rewritten[0]!.content[0]!.result.screenshots[0]!.image_url.url,
      ).toBe("/api/files/proj-1/so-1");
    });
  });

  describe("given values with no media", () => {
    it("returns the exact same reference for objects, arrays, and strings", async () => {
      const { service, calls } = makeFakeService();
      const cases: unknown[] = [
        [{ role: "user", content: "plain" }],
        { type: "json", value: { a: 1, b: [2, 3] } },
        "just a string mentioning base64 without a data uri",
        42,
        null,
      ];
      for (const value of cases) {
        const result = await extractInlineMediaFromValue({
          value,
          service,
          ...PARAMS,
        });
        expect(result.value).toBe(value);
        expect(result.refs).toHaveLength(0);
      }
      expect(calls).toHaveLength(0);
    });

    it("passes through a non-string image property without throwing", async () => {
      const { service, calls } = makeFakeService();
      const value = { image: { width: 100, height: 50 } };

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.value).toBe(value);
      expect(calls).toHaveLength(0);
    });
  });

  describe("given pathological nesting beyond the depth cap", () => {
    it("stops walking and returns the value unchanged", async () => {
      const { service, calls } = makeFakeService();
      // 10 nested JSON-string hops (> MAX_WALK_DEPTH) around a media part
      let inner = JSON.stringify({
        type: "file",
        mediaType: "audio/wav",
        data: AUDIO_B64,
      });
      for (let i = 0; i < 10; i++) {
        inner = JSON.stringify({ type: "file-wrapper", value: inner });
      }

      const result = await extractInlineMediaFromValue({
        value: inner,
        service,
        ...PARAMS,
      });

      expect(result.value).toBe(inner);
      expect(calls).toHaveLength(0);
    });
  });

  describe("given a companded G.711 realtime recording", () => {
    it("stores it decoded to linear PCM16 WAV so browsers can play it", async () => {
      const { service, calls } = makeFakeService();
      // µ-law byte 0x00 decodes to the maximum-magnitude negative sample
      // (-32124) in the standard CCITT expansion — a strong signal the
      // decode really ran instead of the bytes being copied through.
      const samples = Buffer.from([0x00, 0xff, 1, 2, 3, 4, 5, 8]);
      const value = [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: {
                data: samples.toString("base64"),
                format: "g711_ulaw",
              },
            },
          ],
        },
      ];

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.refs).toHaveLength(1);
      expect(calls[0]!.mediaType).toBe("audio/wav");
      const wav = calls[0]!.bytes;
      expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
      // Browser WAV decoders are PCM-only: the companded bytes must be
      // expanded, never stored under fmt codes 6/7.
      expect(wav.readUInt16LE(20)).toBe(1); // linear PCM
      expect(wav.readUInt32LE(24)).toBe(8000); // telephony sample rate
      expect(wav.readUInt16LE(34)).toBe(16); // 16-bit after expansion
      expect(wav.length).toBe(44 + samples.length * 2);
      expect(wav.readInt16LE(44)).toBe(-32124); // µ-law 0x00
      expect(wav.readInt16LE(46)).toBe(0); // µ-law 0xff
    });
  });

  describe("given a bare data-URI image property", () => {
    it("externalizes the bare image shape", async () => {
      const { service } = makeFakeService();
      const value = { image: `data:image/jpeg;base64,${AUDIO_B64}` };

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.refs).toHaveLength(1);
      expect((result.value as { image: string }).image).toBe(
        "/api/files/proj-1/so-1",
      );
    });
  });
});

describe("extraction budget", () => {
  const imagePart = (i: number) => ({
    type: "image_url",
    image_url: { url: `data:image/png;base64,QUJD${i}A` },
  });
  const contentWith = (count: number) => [
    {
      role: "user",
      content: Array.from({ length: count }, (_, i) => imagePart(i)),
    },
  ];

  describe("given more inline parts than the per-span cap", () => {
    /** @scenario Extraction cost inside the collector request is bounded */
    it("externalizes at most the cap and leaves the rest inline, counted", async () => {
      const { service, calls } = makeFakeService();
      const budget = createExtractionBudget();
      const value = contentWith(MAX_MEDIA_PARTS_PER_SPAN + 4);

      const result = await extractInlineMediaFromValue({
        value,
        service,
        budget,
        ...PARAMS,
      });

      expect(calls).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(result.refs).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(budget.droppedByCap).toBe(4);
      const parts = (
        result.value as Array<{
          content: Array<{ image_url: { url: string } }>;
        }>
      )[0]!.content;
      const externalized = parts.filter((p) =>
        p.image_url.url.startsWith("/api/files/"),
      );
      const inline = parts.filter((p) => p.image_url.url.startsWith("data:"));
      expect(externalized).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(inline).toHaveLength(4);
    });
  });

  describe("given the deadline has already passed", () => {
    it("stores nothing and returns the value unchanged by identity", async () => {
      const { service, calls } = makeFakeService();
      const budget = createExtractionBudget();
      budget.deadlineAt = Date.now() - 1;
      const value = contentWith(3);

      const result = await extractInlineMediaFromValue({
        value,
        service,
        budget,
        ...PARAMS,
      });

      expect(calls).toHaveLength(0);
      expect(result.value).toBe(value);
      expect(budget.droppedByDeadline).toBe(3);
    });
  });

  describe("given the deadline expires between store waves", () => {
    it("keeps references for parts already stored (no orphaned bytes)", async () => {
      const calls: number[] = [];
      const service = {
        storeFromBytes: async () => {
          calls.push(calls.length);
          // Each wave takes ~40ms; the deadline lands inside the first wave.
          await new Promise((resolve) => setTimeout(resolve, 40));
          return { id: `so-${calls.length}`, isDuplicate: false };
        },
      } as unknown as StoredObjectsService;
      const budget = createExtractionBudget();
      budget.deadlineAt = Date.now() + 20;
      // 8 parts = two waves of 4: wave one launches before the deadline,
      // wave two is checked after it and dropped.
      const value = contentWith(8);

      const result = await extractInlineMediaFromValue({
        value,
        service,
        budget,
        ...PARAMS,
      });

      expect(calls).toHaveLength(4);
      expect(result.refs).toHaveLength(4);
      expect(budget.droppedByDeadline).toBe(4);
      const parts = (
        result.value as Array<{
          content: Array<{ image_url: { url: string } }>;
        }>
      )[0]!.content;
      // The stored four are referenced in the rewritten value — a deadline
      // never orphans bytes that were already written.
      expect(
        parts.filter((p) => p.image_url.url.startsWith("/api/files/")),
      ).toHaveLength(4);
    });
  });

  describe("given one part's store fails", () => {
    it("keeps that part inline and every other part's reference", async () => {
      let call = 0;
      const service = {
        storeFromBytes: async () => {
          call += 1;
          if (call === 2) throw new Error("S3 hiccup");
          return { id: `so-${call}`, isDuplicate: false };
        },
      } as unknown as StoredObjectsService;
      const budget = createExtractionBudget();
      const value = contentWith(3);

      const result = await extractInlineMediaFromValue({
        value,
        service,
        budget,
        ...PARAMS,
      });

      expect(budget.failedParts).toBe(1);
      expect(result.refs).toHaveLength(2);
      const parts = (
        result.value as Array<{
          content: Array<{ image_url: { url: string } }>;
        }>
      )[0]!.content;
      expect(
        parts.filter((p) => p.image_url.url.startsWith("/api/files/")),
      ).toHaveLength(2);
      expect(
        parts.filter((p) => p.image_url.url.startsWith("data:")),
      ).toHaveLength(1);
    });
  });

  describe("given one budget shared across several attribute values", () => {
    it("applies the part cap to the span, not to each attribute", async () => {
      const { service, calls } = makeFakeService();
      const budget = createExtractionBudget();

      const first = await extractInlineMediaFromValue({
        value: contentWith(MAX_MEDIA_PARTS_PER_SPAN - 2),
        service,
        budget,
        ...PARAMS,
      });
      const second = await extractInlineMediaFromValue({
        value: contentWith(6),
        service,
        budget,
        ...PARAMS,
      });

      expect(first.refs).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN - 2);
      expect(second.refs).toHaveLength(2);
      expect(calls).toHaveLength(MAX_MEDIA_PARTS_PER_SPAN);
      expect(budget.droppedByCap).toBe(4);
    });
  });

  describe("given a whole-attribute bare data URI", () => {
    it("externalizes it to a bare reference string", async () => {
      const { service, calls } = makeFakeService();
      const value = `data:application/pdf;base64,${AUDIO_B64}`;

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.refs).toHaveLength(1);
      expect(result.value).toBe("/api/files/proj-1/so-1");
      expect(calls[0]!.mediaType).toBe("application/pdf");
    });

    it("wraps a bare raw-audio data URI into playable WAV at store time", async () => {
      const { service, calls } = makeFakeService();
      const pcm = Buffer.from([0x00, 0x00, 0x10, 0x20]);
      const value = `data:audio/pcm16;base64,${pcm.toString("base64")}`;

      const result = await extractInlineMediaFromValue({
        value,
        service,
        ...PARAMS,
      });

      expect(result.refs).toHaveLength(1);
      expect(result.value).toBe("/api/files/proj-1/so-1");
      expect(calls[0]!.mediaType).toBe("audio/wav");
      expect(calls[0]!.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    });
  });
});
