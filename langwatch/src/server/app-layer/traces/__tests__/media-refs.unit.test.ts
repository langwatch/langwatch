/**
 * @vitest-environment node
 *
 * Unit tests for the compact trace-level media refs
 * (specs/traces-v2/media-rendering.feature — the trace list and drawer
 * summary render from fold-derived refs, not from span payloads).
 */
import { describe, expect, it } from "vitest";
import {
  collectMediaRefs,
  MAX_TRACE_MEDIA_REFS,
  parseMediaRefs,
  serializeMediaRefs,
} from "../media-refs";

describe("collectMediaRefs", () => {
  describe("given a winning span IO with externalized media", () => {
    it("collects url refs for images, audio, and named attachments", () => {
      const value = [
        {
          role: "user",
          content: [
            { type: "text", text: "look at this" },
            { type: "image_url", image_url: { url: "/api/files/p1/i1" } },
            {
              type: "input_audio",
              input_audio: { url: "/api/files/p1/a1", mimeType: "audio/wav" },
            },
            {
              type: "binary",
              mimeType: "application/pdf",
              url: "/api/files/p1/f1",
              filename: "report.pdf",
            },
          ],
        },
      ];

      expect(collectMediaRefs(value)).toEqual([
        { kind: "image", url: "/api/files/p1/i1" },
        { kind: "audio", url: "/api/files/p1/a1" },
        {
          kind: "file",
          url: "/api/files/p1/f1",
          filename: "report.pdf",
          mimeType: "application/pdf",
        },
      ]);
    });
  });

  describe("given inline base64 media that was never externalized", () => {
    it("keeps refs url-only so the summary never re-bloats", () => {
      const value = [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "application/pdf",
              data: "QUJD",
            },
          ],
        },
      ];
      expect(collectMediaRefs(value)).toEqual([]);
    });
  });

  describe("given more media than the cap", () => {
    it("keeps at most the cap", () => {
      const parts = Array.from({ length: 10 }, (_, i) => ({
        type: "image_url",
        image_url: { url: `/api/files/p1/i${i}` },
      }));
      const refs = collectMediaRefs([{ role: "user", content: parts }]);
      expect(refs).toHaveLength(MAX_TRACE_MEDIA_REFS);
    });
  });
});

describe("serializeMediaRefs and parseMediaRefs", () => {
  it("round-trips through the reserved attribute value", () => {
    const value = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "/api/files/p1/i1" } },
        ],
      },
    ];
    const serialized = serializeMediaRefs(value);
    expect(serialized).not.toBeNull();
    expect(parseMediaRefs(serialized)).toEqual([
      { kind: "image", url: "/api/files/p1/i1" },
    ]);
  });

  it("serializes media-free values to null so the attribute is cleared", () => {
    expect(serializeMediaRefs([{ role: "user", content: "hello" }])).toBeNull();
  });

  it("parses garbage defensively to an empty list", () => {
    expect(parseMediaRefs("not json")).toEqual([]);
    expect(parseMediaRefs(`{"kind":"image"}`)).toEqual([]);
    expect(parseMediaRefs(`[{"kind":"nope","url":"/x"}]`)).toEqual([]);
    expect(parseMediaRefs(null)).toEqual([]);
  });
});
