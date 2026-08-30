/**
 * @vitest-environment node
 *
 * The content-lift cap, and specifically that its default is DERIVED.
 *
 * There were two `capPayloadString`s: this one, whose default comes from
 * `DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES` in `trace-attribute-cap.rules`, and a
 * copy in `payload-cap.rules.ts` that declared its own `256 * 1024`. The three
 * claude-code content-lift sites imported the copy. They agreed on the number,
 * so nothing was miscounted — but tuning the shared constant would have moved
 * the exported path and left those three at the old ceiling.
 *
 * These cases are written against the shared constant rather than against
 * 262144, so they follow it wherever it goes.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES } from "../trace-attribute-cap.rules";
import { capPayloadString } from "../trace-payload-cap.rules";

const MARKER = /…\[langwatch: truncated.*, \d+ bytes total\]$/u;

describe("capPayloadString", () => {
  describe("given a payload inside the shared ceiling", () => {
    it("returns it byte for byte", () => {
      const value = "a".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES);

      expect(capPayloadString(value)).toBe(value);
    });
  });

  describe("given a payload over the shared ceiling", () => {
    it("cuts it and says so", () => {
      const value = "a".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1);

      const capped = capPayloadString(value);

      expect(capped).not.toBe(value);
      expect(capped).toMatch(MARKER);
    });

    it("keeps the result inside the ceiling, marker included", () => {
      const value = "a".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES * 2);

      const capped = capPayloadString(value);

      expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(
        DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES,
      );
    });

    it("names the original size so the cut is self-describing", () => {
      const value = "a".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 10);

      expect(capPayloadString(value)).toContain(`${DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 10} bytes`);
    });
  });

  describe("given a label", () => {
    it("embeds it in the marker", () => {
      const value = "a".repeat(DEFAULT_MAX_ATTRIBUTE_VALUE_BYTES + 1);

      expect(capPayloadString(value, undefined, "api_response_body")).toContain(
        "truncated api_response_body",
      );
    });
  });

  describe("given an explicit ceiling", () => {
    it("uses that instead of the shared one", () => {
      expect(capPayloadString("a".repeat(100), 50)).toMatch(MARKER);
      expect(capPayloadString("a".repeat(100), 1_000)).toBe("a".repeat(100));
    });
  });
});
