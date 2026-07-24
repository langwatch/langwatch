/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import {
  classifyHttpFailure,
  cleanErrorDetail,
  formatFetchError,
  formatHttpError,
} from "../format-execution-error";

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

  describe("classifyHttpFailure", () => {
    it("classifies a 500 with a parsed detail as user_code", () => {
      expect(
        classifyHttpFailure({ status: 500, parsedDetail: "ValueError: x" }),
      ).toBe("user_code");
    });

    it("classifies a 500 without a parsed detail as nlp_service", () => {
      expect(classifyHttpFailure({ status: 500 })).toBe("nlp_service");
    });

    it("classifies any non-500 status as nlp_service", () => {
      expect(classifyHttpFailure({ status: 503, parsedDetail: "down" })).toBe(
        "nlp_service",
      );
    });
  });

  describe("formatHttpError", () => {
    it("formats a 500 with detail as a user-code failure", () => {
      const out = formatHttpError({
        status: 500,
        rawBody: "ignored",
        parsedDetail: "ValueError: x",
      });
      expect(out.source).toBe("user_code");
      expect(out.message).toMatch(/user code raised an error/);
      expect(out.message).toMatch(/status: 500/);
      expect(out.message).toMatch(/ValueError: x/);
    });

    it("formats a 503 as an infra failure", () => {
      const out = formatHttpError({
        status: 503,
        rawBody: "service down",
        parsedDetail: "service down",
      });
      expect(out.source).toBe("nlp_service");
      expect(out.message).toMatch(/NLP service returned HTTP 503/);
      expect(out.message).toMatch(/service down/);
    });

    it("formats a 500 without a parsed detail as an infra failure (treats raw body as opaque)", () => {
      const out = formatHttpError({
        status: 500,
        rawBody: "<html>500</html>",
      });
      expect(out.source).toBe("nlp_service");
      expect(out.message).toMatch(/NLP service returned HTTP 500/);
      expect(out.message).toMatch(/<html>500<\/html>/);
    });

    it("renders an empty body marker when no body is available", () => {
      const out = formatHttpError({
        status: 502,
        rawBody: "",
      });
      expect(out.message).toMatch(/\(empty\)/);
    });

    it("never leaks an internal endpoint into the surfaced message", () => {
      const userCode = formatHttpError({
        status: 500,
        rawBody: "x",
        parsedDetail: "boom",
      });
      const infra = formatHttpError({
        status: 503,
        rawBody: "down",
        parsedDetail: "down",
      });
      expect(userCode.message).not.toMatch(/execute_sync|https?:\/\//);
      expect(infra.message).not.toMatch(/execute_sync|https?:\/\//);
    });

    it("returns a source that always agrees with the message wording", () => {
      const userCode = formatHttpError({
        status: 500,
        rawBody: "x",
        parsedDetail: "ValueError: x",
      });
      expect(userCode.source).toBe("user_code");
      expect(userCode.message).toMatch(/user code raised an error/);

      const infra500 = formatHttpError({ status: 500, rawBody: "<html>" });
      expect(infra500.source).toBe("nlp_service");
      expect(infra500.message).toMatch(/NLP service returned HTTP 500/);

      const infra503 = formatHttpError({
        status: 503,
        rawBody: "down",
        parsedDetail: "down",
      });
      expect(infra503.source).toBe("nlp_service");
      expect(infra503.message).toMatch(/NLP service returned HTTP 503/);
    });
  });

  describe("formatFetchError", () => {
    it("formats a timeout with the configured ms", () => {
      const out = formatFetchError({
        cause: new Error("aborted"),
        timedOutAfterMs: 120_000,
      });
      expect(out).toMatch(/did not respond within 120000ms/);
    });

    it("does not leak an internal endpoint into the timeout message", () => {
      const out = formatFetchError({
        cause: new Error("aborted"),
        timedOutAfterMs: 120_000,
      });
      expect(out).not.toMatch(/execute_sync|https?:\/\//);
    });

    it("formats a generic fetch failure with cause and inner cause", () => {
      const innerCause = new Error("ENOTFOUND");
      const outer = new Error("fetch failed", { cause: innerCause });
      const out = formatFetchError({ cause: outer });
      expect(out).toMatch(/failed to reach NLP service/);
      expect(out).toMatch(/cause: fetch failed/);
      expect(out).toMatch(/cause: Error: ENOTFOUND/);
    });
  });
});
