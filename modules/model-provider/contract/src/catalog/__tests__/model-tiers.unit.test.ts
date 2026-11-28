import { describe, expect, it } from "vitest";

import { pickNewestChatModel } from "../model-tiers.ts";

/** A Bedrock provider's custom model list, in the order it was saved. */
const bedrockModels = [
  "bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0",
  "bedrock/us.amazon.nova-micro-v1:0",
  "bedrock/us.amazon.nova-pro-v1:0",
  "bedrock/us.amazon.nova-lite-v1:0",
  "bedrock/us.amazon.nova-premier-v1:0",
  "bedrock/us.writer.palmyra-x5-v1:0",
  "bedrock/us.writer.palmyra-x4-v1:0",
  "bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  "bedrock/us.anthropic.claude-opus-4-1-20250805-v1:0",
  "bedrock/global.anthropic.claude-opus-4-6-v1",
  "bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0",
];

describe("pickNewestChatModel", () => {
  describe("given a Bedrock list whose first model is an old generation", () => {
    it("picks the newest main-tier model, read through the Bedrock envelope", () => {
      expect(pickNewestChatModel({ models: bedrockModels })).toBe(
        "bedrock/global.anthropic.claude-opus-4-6-v1",
      );
    });
  });

  describe("given only fast-tier models", () => {
    it("picks the newest of them", () => {
      expect(
        pickNewestChatModel({
          models: [
            "bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0",
            "bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0",
            "bedrock/us.amazon.nova-pro-v1:0",
          ],
        }),
      ).toBe("bedrock/global.anthropic.claude-sonnet-4-5-20250929-v1:0");
    });
  });

  describe("given catalogue ids", () => {
    it("ranks them by the same grammar the latest aliases use", () => {
      expect(
        pickNewestChatModel({
          models: ["openai/gpt-5.5-mini", "openai/gpt-5.6-terra", "openai/gpt-5.5"],
        }),
      ).toBe("openai/gpt-5.6-terra");
    });
  });

  describe("given no model the grammar ranks", () => {
    it("keeps the first one", () => {
      expect(
        pickNewestChatModel({
          models: ["bedrock/us.amazon.nova-pro-v1:0", "bedrock/us.writer.palmyra-x5-v1:0"],
        }),
      ).toBe("bedrock/us.amazon.nova-pro-v1:0");
    });
  });

  describe("given an empty list", () => {
    it("picks nothing", () => {
      expect(pickNewestChatModel({ models: [] })).toBeNull();
    });
  });
});
