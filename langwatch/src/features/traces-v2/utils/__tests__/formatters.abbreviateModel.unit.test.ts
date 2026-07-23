import { describe, expect, it } from "vitest";
import { abbreviateModel } from "../formatters";

describe("abbreviateModel", () => {
  describe("given a bare model id (no vendor prefix)", () => {
    it("strips Anthropic's context-window-variant suffix", () => {
      expect(abbreviateModel("claude-opus-4-8[1m]")).toBe("claude-opus-4-8");
    });

    it("still applies the abbreviation table without a provider segment", () => {
      expect(abbreviateModel("claude-haiku-4-5-20251001")).toBe("haiku-4.5");
    });

    it("leaves an already-short bare id untouched", () => {
      expect(abbreviateModel("claude-opus-4-8")).toBe("claude-opus-4-8");
    });
  });

  describe("given a vendor-prefixed model id", () => {
    it("keeps the provider segment and abbreviates the rest", () => {
      expect(abbreviateModel("openai/gpt-4o-mini")).toBe("openai/4o-mini");
    });

    it("strips a context-variant suffix even with a provider segment", () => {
      expect(abbreviateModel("anthropic/claude-opus-4-8[1m]")).toBe(
        "anthropic/claude-opus-4-8",
      );
    });
  });
});
