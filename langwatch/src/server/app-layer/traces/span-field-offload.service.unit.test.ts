import { describe, it, expect } from "vitest";
import {
  utf8Preview,
  DEFAULT_PREVIEW_BYTES,
} from "./span-field-offload.service";

describe("utf8Preview", () => {
  it("returns the value unchanged when within the byte budget", () => {
    expect(utf8Preview("hello", 100)).toBe("hello");
  });

  it("truncates to the byte budget without splitting a multibyte codepoint", () => {
    // "🌍" is 4 UTF-8 bytes; budget of 2 must not emit a broken codepoint
    const out = utf8Preview("🌍🌍🌍", 2);
    expect(out.endsWith("…")).toBe(true);
    // valid UTF-8 (no U+FFFD replacement chars from a mid-codepoint cut)
    expect(out).not.toContain("�");
  });

  it("defaults preview budget to 2 KB", () => {
    const out = utf8Preview("Z".repeat(10_000), DEFAULT_PREVIEW_BYTES);
    expect(Buffer.byteLength(out, "utf-8")).toBeLessThanOrEqual(
      DEFAULT_PREVIEW_BYTES + 4,
    );
  });
});
