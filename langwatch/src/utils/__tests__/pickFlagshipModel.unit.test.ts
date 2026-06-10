/**
 * Unit tests for the client-side flagship/mini/embedding picker.
 *
 * Pins the behaviour the "Use as default" toggle on the provider
 * drawer relies on: when a fresh provider is enabled and we need to
 * pre-fill role-default model fields, we pick the actual flagship,
 * not whatever happens to be first in the provider's model array.
 *
 * Caught on rchaves's 2026-05-18 dogfood: a fresh Gemini drawer pre-
 * filled `gemini-3.1-flash-lite` as DEFAULT because the old code fell
 * back to `chatOptions[0]` (alphabetical first) when the global
 * DEFAULT_MODEL constant didn't match the provider prefix.
 *
 * Mirrors the server-side `buildSeedPlanForProvider` logic.
 */
import { describe, expect, it } from "vitest";

import {
  pickFlagshipFromOptions,
  pickLatestEmbeddingFromOptions,
} from "../pickFlagshipModel";

describe("pickFlagshipFromOptions", () => {
  describe("openai", () => {
    it("picks the newest plain gpt as flagship", () => {
      const options = [
        "openai/gpt-5.0",
        "openai/gpt-5.5",
        "openai/gpt-5.5-mini",
        "openai/gpt-5.2",
      ];
      expect(pickFlagshipFromOptions("openai", "flagship", options)).toBe(
        "openai/gpt-5.5",
      );
    });

    it("picks the newest -mini as mini", () => {
      const options = [
        "openai/gpt-5.0-mini",
        "openai/gpt-5.5",
        "openai/gpt-5.4-mini",
        "openai/gpt-5.5-mini",
      ];
      expect(pickFlagshipFromOptions("openai", "mini", options)).toBe(
        "openai/gpt-5.5-mini",
      );
    });

    it("returns undefined when nothing matches the variant", () => {
      const options = ["openai/gpt-5.5-mini"];
      expect(pickFlagshipFromOptions("openai", "flagship", options)).toBe(
        undefined,
      );
    });
  });

  describe("anthropic", () => {
    it("picks the newest claude-sonnet as flagship", () => {
      const options = [
        "anthropic/claude-sonnet-4-5",
        "anthropic/claude-sonnet-4-6",
        "anthropic/claude-haiku-4-5",
        "anthropic/claude-sonnet-3-7",
      ];
      expect(pickFlagshipFromOptions("anthropic", "flagship", options)).toBe(
        "anthropic/claude-sonnet-4-6",
      );
    });

    it("picks the newest claude-sonnet as mini too", () => {
      // Anthropic intentionally maps FAST to sonnet (not haiku). Haiku
      // trails sonnet by a wide enough margin on assistive tasks that
      // we use sonnet across the board for this provider.
      const options = [
        "anthropic/claude-haiku-4-5",
        "anthropic/claude-sonnet-4-6",
        "anthropic/claude-sonnet-3-7",
      ];
      expect(pickFlagshipFromOptions("anthropic", "mini", options)).toBe(
        "anthropic/claude-sonnet-4-6",
      );
    });
  });

  describe("gemini", () => {
    /**
     * @scenario A fresh Gemini drawer picks the flagship pro-preview, not flash-lite
     */
    it("picks the newest gemini-pro (including -preview) as flagship", () => {
      const options = [
        "gemini/gemini-3.1-flash-lite",
        "gemini/gemini-3.1-pro-preview",
        "gemini/gemini-3.0-pro",
        "gemini/gemini-2.5-pro",
      ];
      expect(pickFlagshipFromOptions("gemini", "flagship", options)).toBe(
        "gemini/gemini-3.1-pro-preview",
      );
    });

    it("picks the newest gemini-flash (including -lite / -preview) as mini", () => {
      const options = [
        "gemini/gemini-3.1-flash-lite",
        "gemini/gemini-3.1-pro-preview",
        "gemini/gemini-3.0-flash",
        "gemini/gemini-2.5-flash-thinking",
      ];
      expect(pickFlagshipFromOptions("gemini", "mini", options)).toBe(
        "gemini/gemini-3.1-flash-lite",
      );
    });

    it("does not confuse pro and flash families", () => {
      const flashOnly = ["gemini/gemini-3.1-flash-lite"];
      expect(pickFlagshipFromOptions("gemini", "flagship", flashOnly)).toBe(
        undefined,
      );
    });
  });

  it("returns undefined for unknown providers", () => {
    expect(pickFlagshipFromOptions("cohere", "flagship", ["cohere/command-r"])).toBe(
      undefined,
    );
  });
});

describe("pickLatestEmbeddingFromOptions", () => {
  it("ranks by the first numeric chunk in the model id", () => {
    const options = [
      "openai/text-embedding-2",
      "openai/text-embedding-3-small",
      "openai/text-embedding-3-large",
    ];
    // 3-small and 3-large tie on the first numeric chunk (3); the
    // stable sort keeps the original input order, so the first
    // 3-something entry wins. The fix here is just "newer beats
    // older", not "small vs large".
    expect(pickLatestEmbeddingFromOptions("openai", options)).toBe(
      "openai/text-embedding-3-small",
    );
  });

  it("ignores models from other providers", () => {
    const options = [
      "openai/text-embedding-3-small",
      "gemini/gemini-embedding-2-preview",
    ];
    expect(pickLatestEmbeddingFromOptions("gemini", options)).toBe(
      "gemini/gemini-embedding-2-preview",
    );
  });

  it("returns undefined when no model belongs to the provider", () => {
    expect(
      pickLatestEmbeddingFromOptions("gemini", ["openai/text-embedding-3-small"]),
    ).toBe(undefined);
  });
});
