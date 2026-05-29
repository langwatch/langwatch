import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_STORED_PAYLOAD_BYTES,
  capStoredJson,
  capStoredText,
  utf8ByteLength,
} from "../capStoredPayload";

describe("capStoredJson", () => {
  describe("given a null or undefined value", () => {
    it("returns null", () => {
      expect(capStoredJson(null)).toBeNull();
      expect(capStoredJson(undefined)).toBeNull();
    });
  });

  describe("given a value within the cap", () => {
    it("returns the value serialized byte-for-byte", () => {
      const value = { question: "what is 2+2?", answer: "4" };
      expect(capStoredJson(value)).toBe(JSON.stringify(value));
    });

    it("serializes an empty object unchanged", () => {
      expect(capStoredJson({})).toBe("{}");
    });
  });

  describe("given a value over the cap", () => {
    const big = { conversation: "x".repeat(5 * 1024 * 1024) };
    const capped = capStoredJson(big, 32 * 1024);

    it("stays valid JSON that downstream JSON.parse can read", () => {
      expect(() => JSON.parse(capped!)).not.toThrow();
    });

    it("marks the payload as truncated with the original size", () => {
      const parsed = JSON.parse(capped!) as {
        _truncated: boolean;
        _originalBytes: number;
        _maxBytes: number;
      };
      expect(parsed._truncated).toBe(true);
      expect(parsed._originalBytes).toBe(utf8ByteLength(JSON.stringify(big)));
      expect(parsed._maxBytes).toBe(32 * 1024);
    });

    it("collapses a multi-MB input to a small placeholder", () => {
      expect(utf8ByteLength(capped!)).toBeLessThan(32 * 1024);
    });

    it("keeps a preview of the original payload for debugging", () => {
      const parsed = JSON.parse(capped!) as { _preview: string };
      expect(parsed._preview.length).toBeGreaterThan(0);
      expect(parsed._preview.startsWith('{"conversation":"xxx')).toBe(true);
    });
  });

  describe("given a cap tighter than the preview size", () => {
    const big = { conversation: "x".repeat(1024 * 1024) };

    it("keeps the placeholder within the tight cap", () => {
      const capped = capStoredJson(big, 512);
      expect(utf8ByteLength(capped!)).toBeLessThanOrEqual(512);
      expect(() => JSON.parse(capped!)).not.toThrow();
    });

    it("still produces valid JSON when the cap leaves no room for a preview", () => {
      const capped = capStoredJson(big, 64);
      expect(() => JSON.parse(capped!)).not.toThrow();
      const parsed = JSON.parse(capped!) as { _truncated: boolean; _preview: string };
      expect(parsed._truncated).toBe(true);
      expect(parsed._preview).toBe("");
    });
  });

  describe("given a value that JSON.stringify drops to undefined", () => {
    it("returns null rather than the literal string undefined", () => {
      expect(capStoredJson(() => 1)).toBeNull();
    });
  });
});

describe("capStoredText", () => {
  describe("given a null or undefined value", () => {
    it("returns it unchanged", () => {
      expect(capStoredText(null)).toBeNull();
      expect(capStoredText(undefined)).toBeUndefined();
    });
  });

  describe("given text within the cap", () => {
    it("returns it unchanged", () => {
      const text = "a normal short trace output";
      expect(capStoredText(text)).toBe(text);
    });
  });

  describe("given text over the cap", () => {
    const text = "y".repeat(2 * 1024 * 1024);
    const capped = capStoredText(text, 32 * 1024);

    it("stays at or under the byte cap", () => {
      expect(utf8ByteLength(capped)).toBeLessThanOrEqual(32 * 1024);
    });

    it("appends a marker naming the original size", () => {
      expect(capped.endsWith(`bytes total]`)).toBe(true);
      expect(capped).toContain(String(utf8ByteLength(text)));
    });
  });

  describe("given multibyte text right at the boundary", () => {
    it("never throws and stays within the cap", () => {
      const emoji = "😀".repeat(20 * 1024); // 4 bytes each
      const capped = capStoredText(emoji, 1024);
      expect(utf8ByteLength(capped)).toBeLessThanOrEqual(1024);
    });
  });

  describe("default cap", () => {
    it("is 32KB", () => {
      expect(DEFAULT_MAX_STORED_PAYLOAD_BYTES).toBe(32 * 1024);
    });
  });
});
