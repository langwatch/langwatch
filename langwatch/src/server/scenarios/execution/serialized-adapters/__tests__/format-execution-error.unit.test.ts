/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  cleanErrorDetail,
  formatFetchError,
  formatHttpError,
} from "../format-execution-error";

const ctx = { endpoint: "http://nlp:8080/studio/execute_sync", method: "POST" } as const;

describe("format-execution-error helpers (lw#3439)", () => {
  describe("cleanErrorDetail", () => {
    it("removes ANSI escape sequences", () => {
      const raw = "\x1b[31mred error\x1b[0m on line 1";
      expect(cleanErrorDetail(raw)).toBe("red error on line 1");
    });

    it("strips known AI SDK and OTEL noise lines", () => {
      const raw = [
        "AI SDK Warning (foo): bar",
        "Flushing OTEL traces...",
        "OTEL traces flushed",
        "ValueError: actual error",
      ].join("\n");
      const cleaned = cleanErrorDetail(raw);
      expect(cleaned).not.toMatch(/AI SDK Warning/);
      expect(cleaned).not.toMatch(/Flushing OTEL traces/);
      expect(cleaned).not.toMatch(/OTEL traces flushed/);
      expect(cleaned).toMatch(/ValueError: actual error/);
    });

    it("collapses three or more consecutive blank lines", () => {
      const raw = "line a\n\n\n\nline b";
      expect(cleanErrorDetail(raw)).toBe("line a\n\nline b");
    });

    it("truncates very long inputs and includes a marker referencing the original length", () => {
      const raw = "x".repeat(5_000);
      const cleaned = cleanErrorDetail(raw);
      expect(cleaned.length).toBeLessThan(raw.length);
      expect(cleaned).toMatch(/truncated, original was 5000 chars/);
    });
  });

  describe("formatHttpError", () => {
    it("formats a 500 with detail as a user-code failure", () => {
      const out = formatHttpError({
        ctx,
        status: 500,
        rawBody: "ignored",
        parsedDetail: "ValueError: x",
      });
      expect(out).toMatch(/user code raised an error/);
      expect(out).toMatch(/endpoint: POST http:\/\/nlp:8080\/studio\/execute_sync/);
      expect(out).toMatch(/status: 500/);
      expect(out).toMatch(/ValueError: x/);
    });

    it("formats a 503 as an infra failure", () => {
      const out = formatHttpError({
        ctx,
        status: 503,
        rawBody: "service down",
        parsedDetail: "service down",
      });
      expect(out).toMatch(/NLP service returned HTTP 503/);
      expect(out).toMatch(/service down/);
    });

    it("formats a 500 without a parsed detail as an infra failure (treats raw body as opaque)", () => {
      const out = formatHttpError({
        ctx,
        status: 500,
        rawBody: "<html>500</html>",
      });
      expect(out).toMatch(/NLP service returned HTTP 500/);
      expect(out).toMatch(/<html>500<\/html>/);
    });

    it("renders an empty body marker when no body is available", () => {
      const out = formatHttpError({
        ctx,
        status: 502,
        rawBody: "",
      });
      expect(out).toMatch(/\(empty\)/);
    });
  });

  describe("formatFetchError", () => {
    it("formats a timeout with the configured ms", () => {
      const out = formatFetchError({ ctx, cause: new Error("aborted"), timedOutAfterMs: 120_000 });
      expect(out).toMatch(/did not respond within 120000ms/);
      expect(out).toMatch(/endpoint: POST http:\/\/nlp:8080\/studio\/execute_sync/);
    });

    it("formats a generic fetch failure with cause and inner cause", () => {
      const innerCause = new Error("ENOTFOUND");
      const outer = new Error("fetch failed", { cause: innerCause });
      const out = formatFetchError({ ctx, cause: outer });
      expect(out).toMatch(/failed to reach NLP service/);
      expect(out).toMatch(/cause: fetch failed/);
      expect(out).toMatch(/cause: Error: ENOTFOUND/);
    });
  });
});
