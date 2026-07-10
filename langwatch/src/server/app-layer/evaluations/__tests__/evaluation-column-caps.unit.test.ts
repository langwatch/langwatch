/**
 * @vitest-environment node
 *
 * Unit tests for the unconditional write-time column caps (ADR-039) that keep
 * `evaluation_runs` parts merge-safe regardless of the offload feature flag.
 */
import { describe, expect, it } from "vitest";
import {
  capSerializedInputs,
  capText,
  EVAL_INPUTS_ROW_CAP_BYTES,
  EVAL_TEXT_ROW_CAP_BYTES,
  TRUNCATED_MARKER_KEY,
  TRUNCATED_TEXT_SUFFIX,
} from "../evaluation-column-caps";

describe("capSerializedInputs", () => {
  describe("given a serialized value within the cap", () => {
    it("returns the original string untouched", () => {
      const serialized = JSON.stringify({ a: 1, b: "two" });
      const result = capSerializedInputs(serialized);
      expect(result.truncated).toBe(false);
      expect(result.value).toBe(serialized);
    });

    it("passes null through", () => {
      const result = capSerializedInputs(null);
      expect(result.value).toBeNull();
      expect(result.truncated).toBe(false);
    });
  });

  describe("given a serialized value over the cap", () => {
    it("replaces it with a valid-JSON truncation marker carrying originalBytes", () => {
      const serialized = JSON.stringify({
        blob: "x".repeat(EVAL_INPUTS_ROW_CAP_BYTES + 100),
      });
      const originalBytes = Buffer.byteLength(serialized, "utf8");

      const result = capSerializedInputs(serialized);

      expect(result.truncated).toBe(true);
      expect(result.originalBytes).toBe(originalBytes);
      // The replacement must still parse - every reader does JSON.parse(Inputs).
      const parsed = JSON.parse(result.value!);
      expect(parsed[TRUNCATED_MARKER_KEY].originalBytes).toBe(originalBytes);
      expect(parsed[TRUNCATED_MARKER_KEY].cap).toBe(EVAL_INPUTS_ROW_CAP_BYTES);
      // The marker itself is far under the cap.
      expect(Buffer.byteLength(result.value!, "utf8")).toBeLessThan(1024);
    });
  });
});

describe("capText", () => {
  describe("given text within the cap", () => {
    it("returns the original text untouched", () => {
      const text = "a short error message";
      const result = capText(text);
      expect(result.truncated).toBe(false);
      expect(result.value).toBe(text);
    });

    it("passes null through", () => {
      const result = capText(null);
      expect(result.value).toBeNull();
      expect(result.truncated).toBe(false);
    });
  });

  describe("given text over the cap", () => {
    it("truncates on bytes and appends an observable suffix", () => {
      const text = "y".repeat(EVAL_TEXT_ROW_CAP_BYTES + 500);
      const result = capText(text);

      expect(result.truncated).toBe(true);
      expect(result.value!.endsWith(TRUNCATED_TEXT_SUFFIX)).toBe(true);
      const withoutSuffix = result.value!.slice(
        0,
        result.value!.length - TRUNCATED_TEXT_SUFFIX.length,
      );
      expect(Buffer.byteLength(withoutSuffix, "utf8")).toBeLessThanOrEqual(
        EVAL_TEXT_ROW_CAP_BYTES,
      );
    });
  });
});
