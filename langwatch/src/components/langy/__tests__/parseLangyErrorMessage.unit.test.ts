import { describe, expect, it } from "vitest";
import { parseLangyErrorMessage } from "../parseLangyErrorMessage";

describe("parseLangyErrorMessage", () => {
  describe("given a structured rate_limited envelope with retryAfterSeconds", () => {
    it("formats a clean retry message", () => {
      const raw = JSON.stringify({
        error: {
          code: "rate_limited",
          message: "Too many messages. Please slow down.",
          retryAfterSeconds: 30,
        },
      });
      expect(parseLangyErrorMessage(raw)).toBe(
        "Too many messages. Please slow down. Retry in 30s.",
      );
    });
  });

  describe("given a structured rate_limited envelope without retryAfterSeconds", () => {
    it("returns the message alone, no retry tail", () => {
      const raw = JSON.stringify({
        error: { code: "rate_limited", message: "Slow down." },
      });
      expect(parseLangyErrorMessage(raw)).toBe("Slow down.");
    });
  });

  describe("given a structured envelope with an unknown code", () => {
    it("falls back to the inner message", () => {
      const raw = JSON.stringify({
        error: { code: "weird_thing", message: "Something broke." },
      });
      expect(parseLangyErrorMessage(raw)).toBe("Something broke.");
    });
  });

  describe("given a legacy flat error string", () => {
    it("returns the string directly", () => {
      const raw = JSON.stringify({ error: "Unauthorized" });
      expect(parseLangyErrorMessage(raw)).toBe("Unauthorized");
    });
  });

  describe("given an unparseable raw string", () => {
    it("returns the raw string as-is", () => {
      expect(parseLangyErrorMessage("Failed to fetch the chat response.")).toBe(
        "Failed to fetch the chat response.",
      );
    });
  });

  describe("given an empty input", () => {
    it("returns a generic fallback", () => {
      expect(parseLangyErrorMessage("")).toMatch(/error/i);
      expect(parseLangyErrorMessage(undefined)).toMatch(/error/i);
      expect(parseLangyErrorMessage(null)).toMatch(/error/i);
    });
  });

  describe("given JSON that doesn't match any envelope shape", () => {
    it("returns the raw string", () => {
      const raw = JSON.stringify({ foo: "bar" });
      expect(parseLangyErrorMessage(raw)).toBe(raw);
    });
  });
});
