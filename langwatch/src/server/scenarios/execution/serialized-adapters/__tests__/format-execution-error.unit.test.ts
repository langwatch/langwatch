/**
 * @vitest-environment node
 *
 * Unit coverage for the shared adapter error formatter.
 * @see specs/scenarios/adapter-and-worker-resilience.feature — #3439 scenarios
 */
import { describe, expect, it } from "vitest";
import {
  SerializedAdapterError,
  classifyHttpFailure,
  cleanErrorDetail,
} from "../format-execution-error";

describe("SerializedAdapterError", () => {
  describe("when the source is user_code", () => {
    it("prefixes the message with [user code]", () => {
      const err = new SerializedAdapterError({
        adapter: "SerializedCodeAgentAdapter",
        source: "user_code",
        message: "Code execution failed: HTTP 500",
        rawDetail: "Traceback ...\nValueError: boom",
      });

      expect(err.message.startsWith("[user code]")).toBe(true);
      expect(err.message).toContain("SerializedCodeAgentAdapter");
      expect(err.message).toContain("ValueError: boom");
    });
  });

  describe("when the source is network", () => {
    it("prefixes the message with [adapter]", () => {
      const err = new SerializedAdapterError({
        adapter: "SerializedCodeAgentAdapter",
        source: "network",
        message: "request failed",
        endpoint: "http://nlp/studio/execute_sync",
      });
      expect(err.message.startsWith("[adapter]")).toBe(true);
    });
  });

  describe("when the raw detail exceeds the truncation budget", () => {
    it("clips the surfaced message and appends a truncated marker", () => {
      const big = "x".repeat(3000);
      const err = new SerializedAdapterError({
        adapter: "SerializedCodeAgentAdapter",
        source: "user_code",
        message: "Code execution failed: HTTP 500",
        rawDetail: big,
      });
      expect(err.message).toContain("[...truncated");
      expect(err.message.length).toBeLessThan(big.length);
      expect(err.rawDetail).toBe(big);
    });
  });
});

describe("cleanErrorDetail", () => {
  it("strips AI SDK warnings", () => {
    const cleaned = cleanErrorDetail(
      [
        "AI SDK Warning (openai.chat / openai/gpt-5.2): some compat warning",
        "Real error",
      ].join("\n"),
    );
    expect(cleaned).not.toContain("AI SDK Warning");
    expect(cleaned).toContain("Real error");
  });

  it("strips OTEL flush notices", () => {
    const cleaned = cleanErrorDetail(
      ["Flushing OTEL traces...", "OTEL traces flushed", "Real error"].join("\n"),
    );
    expect(cleaned).not.toContain("Flushing OTEL traces");
    expect(cleaned).not.toContain("OTEL traces flushed");
    expect(cleaned).toContain("Real error");
  });

  it("strips ANSI escape sequences", () => {
    const cleaned = cleanErrorDetail("\x1b[31mred error\x1b[0m");
    expect(cleaned).toBe("red error");
  });
});

describe("classifyHttpFailure", () => {
  it("classifies 500 with a Python traceback as user_code", () => {
    expect(
      classifyHttpFailure(500, "Traceback (most recent call last):\nValueError: boom"),
    ).toBe("user_code");
  });

  it("classifies 500 without a traceback as nlp_service", () => {
    expect(classifyHttpFailure(500, "service unavailable")).toBe("nlp_service");
  });

  it("classifies 502/503 as nlp_service even with text", () => {
    expect(classifyHttpFailure(502, "Bad Gateway")).toBe("nlp_service");
    expect(classifyHttpFailure(503, "Service Unavailable")).toBe("nlp_service");
  });

  it("returns nlp_service when detail is missing", () => {
    expect(classifyHttpFailure(500, undefined)).toBe("nlp_service");
  });
});
