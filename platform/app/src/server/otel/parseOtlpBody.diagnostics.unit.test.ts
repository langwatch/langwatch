/**
 * What a decode failure is allowed to say about the body that caused it.
 *
 * Nothing in `parseOtlpBody.ts` logs the request body. It logs the parser's
 * error, and V8's `JSON.parse` SyntaxError quotes roughly ten characters of its
 * input inside that message — so the customer's bytes reached the log sink with
 * no line of ours putting them there. Because those bytes are arbitrary they
 * were frequently not valid UTF-8, which made the resulting log field
 * unparseable to consumers downstream.
 *
 * Spec: specs/observability/ingest-validation-diagnostics.feature
 * ("Before the schema: decoding the body")
 */

import { describe, expect, it } from "vitest";

import {
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
} from "./parseOtlpBody";

/** A string no parser could invent, so finding it proves it came from the body. */
const MARKER = "CUSTOMERSECRETMARKER";

function bodyOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/**
 * Narrows the result to its failure branch and hands back the reported message.
 *
 * Deliberately not an assertion helper: what each test is actually asserting is
 * what the message may and may not contain, and that belongs in the test. A
 * body that decodes here is a broken fixture rather than a failed expectation,
 * so it throws.
 */
function decodeFailureOf({
  body,
  contentType,
}: {
  body: ArrayBuffer;
  contentType?: string | null;
}): string {
  const result = parseOtlpTraces(body, contentType);
  if (result.ok) throw new Error("fixture decoded; it was meant to fail");
  return result.error;
}

describe("given a trace body that cannot be decoded", () => {
  describe("when the parser quotes the body back inside its own error message", () => {
    /** @scenario The parser's quoted snippet of the body never survives */
    it("keeps no part of the body in the reported failure", () => {
      // Invalid JSON whose first offending token is the marker itself, which is
      // exactly what V8 quotes: `Unexpected token 'C', "CUSTOMERSE"... is not
      // valid JSON`.
      const failure = decodeFailureOf({
        body: bodyOf(MARKER),
        contentType: "application/json",
      });

      expect(failure).not.toContain(MARKER);
      expect(failure).not.toContain(MARKER.slice(0, 6));
    });

    /** @scenario The parser's quoted snippet of the body never survives */
    it("keeps no part of the body when the content type is absent", () => {
      const failure = decodeFailureOf({
        body: bodyOf(`{"resourceSpans": ${MARKER}}`),
        contentType: null,
      });

      expect(failure).not.toContain(MARKER);
      expect(failure).not.toContain(MARKER.slice(0, 6));
    });

    /** @scenario The parser's quoted snippet of the body never survives */
    it("keeps no part of the body for logs and metrics either", () => {
      const body = bodyOf(MARKER);

      for (const result of [
        parseOtlpLogs(body, "application/json"),
        parseOtlpMetrics(body, "application/json"),
      ]) {
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).not.toContain(MARKER.slice(0, 6));
      }
    });
  });

  describe("when the body is arbitrary bytes rather than text", () => {
    /** @scenario A decode failure carries only characters we can render */
    it("reports printable ASCII throughout", () => {
      // Bytes chosen to be invalid UTF-8 (0x80-0xFF continuation bytes with no
      // lead) plus control characters — the shape a truncated protobuf export
      // actually arrives in.
      const bytes = new Uint8Array([
        0x0a, 0xff, 0xfe, 0x10, 0x1e, 0x1a, 0x0c, 0x80, 0x9f, 0x00, 0x7f,
      ]);

      const failure = decodeFailureOf({
        body: bytes.buffer as ArrayBuffer,
        contentType: "application/json",
      });

      expect(failure).toMatch(/^[\x20-\x7E]*$/);
    });

    /** @scenario A decode failure carries only characters we can render */
    it("bounds the length of the reported failure", () => {
      const failure = decodeFailureOf({
        body: bodyOf("!".repeat(50_000)),
        contentType: "application/json",
      });

      expect(failure.length).toBeLessThanOrEqual(300);
    });
  });

  describe("when the failure is structural rather than about content", () => {
    /** @scenario A structural decoder error keeps the detail that names the fault */
    it("keeps the decoder's own description of the fault", () => {
      // A protobuf field header that claims far more bytes than were sent, so
      // the decoder fails on the length rather than on any value.
      const truncated = new Uint8Array([0x0a, 0xff, 0x01, 0x01, 0x02]);

      const failure = decodeFailureOf({
        body: truncated.buffer as ArrayBuffer,
        contentType: "application/x-protobuf",
      });

      // The decoder's vocabulary is ours, not the sender's — it is what says
      // whether the sender truncated the body or we mis-read it.
      expect(failure).toMatch(
        /index out of range|invalid wire type|offset|range/i,
      );
    });

    /** @scenario A body that cannot be decoded reports the stage that rejected it */
    it("names both decoding stages that rejected it", () => {
      const failure = decodeFailureOf({
        body: bodyOf("not otlp at all"),
        contentType: "application/json",
      });

      expect(failure).toMatch(/parse OTLP body/i);
      expect(failure).toMatch(/json/i);
    });

    /** @scenario A body that cannot be decoded reports the stage that rejected it */
    it("carries the size of the body in bytes", () => {
      // A size no parser would mention on its own, so finding it proves we put
      // it there. ASCII, so the byte count and the character count agree.
      const failure = decodeFailureOf({
        body: bodyOf("!".repeat(4_096)),
        contentType: "application/json",
      });

      expect(failure).toContain("4096 bytes");
    });
  });
});
