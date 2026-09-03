/**
 * @vitest-environment node
 *
 * Provider media shapes reaching the content-part decoder
 * (specs/trace-processing/trace-media-blob-extraction.feature).
 *
 * Instrumentation for the Anthropic and Google SDKs records the request the
 * customer sent, so a media part arrives in that provider's own vocabulary
 * rather than in the AG-UI one. These pin the two translations: Anthropic's
 * `source` variants and Gemini's typeless `inline_data` carrier.
 */

import { describe, expect, it } from "vitest";
import { visitContentPart } from "../trace-content-part.visitor";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAE=";

/** The media part the decoder resolves, or a tag naming the branch it took. */
function decode(part: unknown) {
  return visitContentPart<unknown>(part, {
    text: (text) => ({ branch: "text", text }),
    media: (p) => ({ branch: "media", ...p }),
    binary: (p) => ({ branch: "binary", ...p }),
    toolCall: () => ({ branch: "toolCall" }),
    toolResult: () => ({ branch: "toolResult" }),
    unknown: () => ({ branch: "unknown" }),
  });
}

describe("visitContentPart", () => {
  describe("given an Anthropic image block", () => {
    /** @scenario An Anthropic image block carries its bytes in a base64 source */
    it("reads the bytes out of its base64 source", () => {
      expect(
        decode({
          type: "image",
          source: { type: "base64", media_type: "image/png", data: PNG_B64 },
        }),
      ).toEqual({
        branch: "media",
        type: "image",
        source: { type: "data", value: PNG_B64, mimeType: "image/png" },
      });
    });

    /** @scenario An Anthropic image block pointing at a hosted URL keeps that URL */
    it("keeps a hosted URL as the source", () => {
      expect(
        decode({
          type: "image",
          source: { type: "url", url: "https://cdn.example/i.png" },
        }),
      ).toEqual({
        branch: "media",
        type: "image",
        source: { type: "url", value: "https://cdn.example/i.png" },
      });
    });
  });

  describe("given an Anthropic document block", () => {
    /** @scenario An Anthropic document block carries its bytes in a base64 source */
    it("reads the bytes out of its base64 source", () => {
      expect(
        decode({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: PNG_B64,
          },
        }),
      ).toEqual({
        branch: "media",
        type: "document",
        source: {
          type: "data",
          value: PNG_B64,
          mimeType: "application/pdf",
        },
      });
    });
  });

  describe("given a Gemini inline-data part", () => {
    /** @scenario A Gemini inline-data part carries its bytes with no part type at all */
    it("recognises it by its carrier, with no part type present", () => {
      expect(
        decode({
          inline_data: { mime_type: "application/pdf", data: PNG_B64 },
        }),
      ).toEqual({
        branch: "media",
        type: "document",
        source: {
          type: "data",
          value: PNG_B64,
          mimeType: "application/pdf",
        },
      });
    });

    /** @scenario A Gemini inline-data part carries its bytes with no part type at all */
    it("reads the JavaScript SDK spelling identically", () => {
      expect(decode({ inlineData: { mimeType: "application/pdf", data: PNG_B64 } })).toEqual(
        decode({
          inline_data: { mime_type: "application/pdf", data: PNG_B64 },
        }),
      );
    });

    /** @scenario The media type of a Gemini inline-data part decides how it renders */
    it.each([
      { mimeType: "image/png", expected: "image" },
      { mimeType: "audio/wav", expected: "audio" },
      { mimeType: "video/mp4", expected: "video" },
      { mimeType: "text/plain", expected: "document" },
    ])("resolves $mimeType to a $expected part", ({ mimeType, expected }) => {
      expect(decode({ inline_data: { mime_type: mimeType, data: PNG_B64 } })).toMatchObject({
        type: expected,
      });
    });

    it("leaves a provider-hosted file_data part alone, since it carries no bytes", () => {
      expect(
        decode({
          file_data: {
            file_uri: "gs://bucket/report.pdf",
            mime_type: "application/pdf",
          },
        }),
      ).toEqual({ branch: "unknown" });
    });
  });

  describe("given a media part whose source shape is not one we speak", () => {
    it("passes it through rather than inventing an empty payload", () => {
      expect(decode({ type: "image", source: { type: "container", id: "abc" } })).toEqual({
        branch: "unknown",
      });
    });
  });
});
