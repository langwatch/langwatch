import { describe, expect, it } from "vitest";
import { validateModelAliasesAgainstBoundProviders } from "../virtualKeyAliasValidation";

describe("validateModelAliasesAgainstBoundProviders", () => {
  describe("when an alias targets a provider not bound on the VK", () => {
    it("returns a validation error naming the unbound provider", () => {
      const { errors } = validateModelAliasesAgainstBoundProviders({
        aliases: { mini: "openai/gpt-5-mini" },
        boundProviderTypes: new Set(["anthropic"]),
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('"mini"');
      expect(errors[0]).toContain('"openai"');
      expect(errors[0]).toContain("anthropic");
    });
  });

  describe("when every alias targets a bound provider", () => {
    it("returns no errors", () => {
      const { errors } = validateModelAliasesAgainstBoundProviders({
        aliases: {
          mini: "openai/gpt-5-mini",
          haiku: "anthropic/claude-haiku",
        },
        boundProviderTypes: new Set(["openai", "anthropic"]),
      });

      expect(errors).toEqual([]);
    });
  });

  describe("when an alias target has no provider prefix", () => {
    it("skips it (runtime resolution handles unprefixed targets)", () => {
      const { errors } = validateModelAliasesAgainstBoundProviders({
        aliases: { mini: "gpt-5-mini" },
        boundProviderTypes: new Set(), // no providers bound at all
      });

      expect(errors).toEqual([]);
    });
  });

  describe("when no providers are bound on the VK", () => {
    it("reports 'bound: none' for any prefixed alias", () => {
      const { errors } = validateModelAliasesAgainstBoundProviders({
        aliases: { mini: "openai/gpt-5-mini" },
        boundProviderTypes: new Set(),
      });

      expect(errors[0]).toContain("bound: none");
    });
  });

  describe("when the alias map is empty", () => {
    it("returns no errors", () => {
      const { errors } = validateModelAliasesAgainstBoundProviders({
        aliases: {},
        boundProviderTypes: new Set(["openai"]),
      });

      expect(errors).toEqual([]);
    });
  });

  describe("when multiple aliases are broken", () => {
    it("reports one error per broken alias", () => {
      const { errors } = validateModelAliasesAgainstBoundProviders({
        aliases: {
          one: "anthropic/claude-opus",
          two: "google/gemini-pro",
          ok: "openai/gpt-5-mini",
        },
        boundProviderTypes: new Set(["openai"]),
      });

      expect(errors).toHaveLength(2);
      expect(errors.some((e) => e.includes("anthropic"))).toBe(true);
      expect(errors.some((e) => e.includes("google"))).toBe(true);
    });
  });

  describe("when the alias target has a provider prefix but empty segment", () => {
    it("does not error on an empty prefix", () => {
      // Pathological input: "/gpt-5-mini" split on "/" yields [""]. A zero-
      // length prefix can never match a real bound provider, but also isn't
      // meaningful — we guard with the truthy check so we don't emit a
      // nonsensical "references provider \"\"" error.
      const { errors } = validateModelAliasesAgainstBoundProviders({
        aliases: { odd: "/gpt-5-mini" },
        boundProviderTypes: new Set(["openai"]),
      });

      expect(errors).toEqual([]);
    });
  });
});
