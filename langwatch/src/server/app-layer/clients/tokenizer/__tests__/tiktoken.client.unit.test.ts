import { describe, expect, it } from "vitest";
import { TiktokenClient } from "../tiktoken.client";
import { NullTokenizerClient } from "../tokenizer.client";

describe("TiktokenClient", () => {
  const client = new TiktokenClient();

  describe("countTokens", () => {
    it("returns a positive token count for non-empty text", async () => {
      const count = await client.countTokens("gpt-4o", "Hello, world!");
      expect(count).toBeGreaterThan(0);
      expect(typeof count).toBe("number");
    });

    it("returns consistent counts for the same input", async () => {
      const count1 = await client.countTokens("gpt-4o", "The quick brown fox");
      const count2 = await client.countTokens("gpt-4o", "The quick brown fox");
      expect(count1).toBe(count2);
    });

    it("returns undefined for empty text", async () => {
      expect(await client.countTokens("gpt-4o", "")).toBe(undefined);
    });

    it("returns undefined for undefined text", async () => {
      expect(await client.countTokens("gpt-4o", undefined)).toBe(undefined);
    });

    it("strips provider prefix from model name", async () => {
      const withPrefix = await client.countTokens("openai/gpt-4o", "Hello");
      const withoutPrefix = await client.countTokens("gpt-4o", "Hello");
      expect(withPrefix).toBe(withoutPrefix);
    });

    it("falls back to o200k_base for unknown models", async () => {
      const count = await client.countTokens(
        "some-unknown-model-xyz",
        "Hello, world!",
      );
      expect(count).toBeGreaterThan(0);
    });
  });
});

describe("NullTokenizerClient", () => {
  const client = new NullTokenizerClient();

  describe("countTokens", () => {
    it("always returns undefined", async () => {
      expect(await client.countTokens("gpt-4o", "Hello, world!")).toBe(
        undefined,
      );
    });
  });
});
