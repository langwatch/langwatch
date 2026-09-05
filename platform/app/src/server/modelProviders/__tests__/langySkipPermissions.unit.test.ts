/**
 * The provider defaults that decide which models Langy may run with the
 * permission checks skipped (ADR-129).
 *
 * Binds the @unit scenarios of
 * specs/settings/model-provider-skip-permissions.feature that are about the
 * DEFAULTS. The gate that reads a conversation's model is bound in
 * src/server/app-layer/langy/__tests__/langySkipPermissions.unit.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  defaultSkipListForProvider,
  firstInvalidSkipPattern,
  matchesSkipList,
  parseSkipListInput,
  resolveSkipList,
  skipListToInput,
} from "../langySkipPermissions";

function allows({
  provider,
  modelId,
}: {
  provider: string;
  modelId: string;
}): boolean {
  return matchesSkipList({
    patterns: defaultSkipListForProvider(provider),
    modelId,
  });
}

describe("Feature: a provider says which models may skip Langy's permission checks", () => {
  describe("given the OpenAI provider with no custom list", () => {
    /** @scenario OpenAI's default allows its frontier models and their successors */
    it("allows the frontier models and their successors, and no small variant", () => {
      for (const modelId of [
        "gpt-5.6-terra",
        "gpt-5.6-sol",
        "gpt-5.7",
        "gpt-5.10",
        "gpt-6",
      ]) {
        expect(allows({ provider: "openai", modelId })).toBe(true);
      }
      for (const modelId of [
        "gpt-5.6-luna",
        "gpt-5.7-mini",
        "gpt-5-mini",
        "gpt-5-nano",
      ]) {
        expect(allows({ provider: "openai", modelId })).toBe(false);
      }
    });
  });

  describe("given the Anthropic provider with no custom list", () => {
    /** @scenario Anthropic's default allows Opus and Fable from version five on */
    it("allows Opus and Fable from version five, and no other line", () => {
      for (const modelId of [
        "claude-opus-5",
        "claude-fable-5-1",
        "claude-opus-6",
      ]) {
        expect(allows({ provider: "anthropic", modelId })).toBe(true);
      }
      for (const modelId of [
        "claude-sonnet-5",
        "claude-haiku-4-5",
        "claude-opus-4-1",
      ]) {
        expect(allows({ provider: "anthropic", modelId })).toBe(false);
      }
    });
  });

  describe("given the Azure, Bedrock, Vertex, Gemini and custom providers with no custom list", () => {
    /** @scenario Every other provider allows nothing by default */
    it("allows no model at all", () => {
      const providers = ["azure", "bedrock", "vertex_ai", "gemini", "custom"];
      const models = [
        "gpt-5.6-terra",
        "gpt-6",
        "claude-opus-6",
        "gemini-3-pro",
        "anything-at-all",
      ];
      for (const provider of providers) {
        expect(defaultSkipListForProvider(provider)).toEqual([]);
        for (const modelId of models) {
          expect(allows({ provider, modelId })).toBe(false);
        }
      }
    });
  });

  describe("given a provider the registry does not know", () => {
    it("allows nothing", () => {
      expect(defaultSkipListForProvider("not-a-provider")).toEqual([]);
    });
  });

  describe("when the field text is read into a list", () => {
    it("takes one pattern per line and drops blanks", () => {
      expect(parseSkipListInput("  ^a$ \n\n^b$\n  \n")).toEqual(["^a$", "^b$"]);
    });

    it("writes a stored list back one per line", () => {
      expect(skipListToInput(["^a$", "^b$"])).toBe("^a$\n^b$");
      expect(skipListToInput(null)).toBe("");
    });
  });

  describe("when a pattern does not compile", () => {
    it("names the first bad line, counting from one", () => {
      expect(
        firstInvalidSkipPattern(["^ok$", "^also-ok", "^(unclosed"]),
      ).toEqual({ line: 3, pattern: "^(unclosed" });
    });

    it("names nothing when every pattern compiles", () => {
      expect(firstInvalidSkipPattern(["^ok$"])).toBeNull();
    });

    it("is ignored on the read side so one bad line denies nothing else", () => {
      expect(
        matchesSkipList({
          patterns: ["^(unclosed", "^gpt-6$"],
          modelId: "gpt-6",
        }),
      ).toBe(true);
    });
  });

  describe("when a stored list is resolved against the default", () => {
    it("replaces the default rather than extending it", () => {
      const patterns = resolveSkipList({
        provider: "openai",
        stored: ["^gpt-6$"],
      });
      expect(matchesSkipList({ patterns, modelId: "gpt-6" })).toBe(true);
      expect(matchesSkipList({ patterns, modelId: "gpt-5.6-terra" })).toBe(
        false,
      );
    });

    it("falls back to the default when the stored list is empty or absent", () => {
      for (const stored of [null, undefined, [], "not a list"]) {
        expect(resolveSkipList({ provider: "anthropic", stored })).toEqual(
          defaultSkipListForProvider("anthropic"),
        );
      }
    });
  });
});
