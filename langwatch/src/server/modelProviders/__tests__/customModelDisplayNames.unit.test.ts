/**
 * Unit tests for the custom-model display-name resolver.
 *
 * Binds the two `@unit` scenarios in
 * specs/model-providers/custom-model-display-name.feature. The
 * `@integration` scenarios in the same file are bound against the
 * components that consume this resolver (ProviderModelSelector,
 * ModelChip, useModelSelectionOptions, etc.) — see their own test files.
 *
 * `buildCustomModelDisplayNames` / `modelDisplayLabel` do not exist yet
 * (issue #5759) — this file is expected to fail on the import until the
 * resolver module is implemented.
 */
import { describe, expect, it } from "vitest";
import type { CustomModelEntry } from "../customModel.schema";
import { toLegacyCompatibleCustomModels } from "../customModel.schema";
import {
  buildCustomModelDisplayNames,
  modelDisplayLabel,
} from "../customModelDisplayNames";
import type { MaybeStoredModelProvider } from "../registry";

const makeProvider = (
  overrides: Partial<MaybeStoredModelProvider> & { provider: string },
): MaybeStoredModelProvider => ({
  enabled: true,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  customModels: null,
  customEmbeddingsModels: null,
  deploymentMapping: null,
  extraHeaders: null,
  ...overrides,
});

describe("buildCustomModelDisplayNames()", () => {
  describe("given a custom chat model with a display name", () => {
    it('keys the map by "<provider>/<modelId>"', () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        custom: makeProvider({
          provider: "custom",
          customModels: [
            { modelId: "gpt-5.1", displayName: "Ada Prod Model", mode: "chat" },
          ],
        }),
      };

      const result = buildCustomModelDisplayNames(providers);

      expect(result["custom/gpt-5.1"]).toBe("Ada Prod Model");
    });
  });

  describe("given both a custom chat model and a custom embeddings model on the same provider", () => {
    it("includes both in one map, regardless of mode", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        custom: makeProvider({
          provider: "custom",
          customModels: [
            { modelId: "gpt-5.1", displayName: "Ada Prod Model", mode: "chat" },
          ],
          customEmbeddingsModels: [
            {
              modelId: "text-embed-3",
              displayName: "Ada Prod Embed",
              mode: "embedding",
            },
          ],
        }),
      };

      const result = buildCustomModelDisplayNames(providers);

      expect(result["custom/gpt-5.1"]).toBe("Ada Prod Model");
      expect(result["custom/text-embed-3"]).toBe("Ada Prod Embed");
    });
  });

  describe("given custom entries whose display name is blank, absent, or whose model id is absent", () => {
    // Mirrors the Background fixture's model id but deliberately uses a
    // blank/absent display name — this block tests the malformed-entry
    // path, not the happy path (which lives in the ProviderModelSelector /
    // ModelChip integration tests).
    const entries: CustomModelEntry[] = [
      { modelId: "gpt-5.1", displayName: "", mode: "chat" },
      { modelId: "gpt-5.2", mode: "chat" } as CustomModelEntry,
      { displayName: "Orphan", mode: "chat" } as CustomModelEntry,
    ];
    const providers: Record<string, MaybeStoredModelProvider> = {
      custom: makeProvider({ provider: "custom", customModels: entries }),
    };

    /** @scenario A blank or incomplete custom entry falls back to the model id */
    it("resolves entries with a model id to that id, skips the entry with no model id, and never yields a blank or undefined name", () => {
      const displayNames = buildCustomModelDisplayNames(providers);

      // Entries with a model id resolve to that model id ...
      expect(modelDisplayLabel("custom/gpt-5.1", displayNames)).toBe("gpt-5.1");
      expect(modelDisplayLabel("custom/gpt-5.2", displayNames)).toBe("gpt-5.2");

      // ... an entry without a model id is skipped (no "custom/undefined" key) ...
      expect(Object.keys(displayNames)).not.toContain("custom/undefined");

      // ... and no entry resolves to a blank or undefined name.
      for (const value of Object.values(displayNames)) {
        expect(value).toBeTruthy();
        expect(value).not.toBe("undefined");
      }
    });

    it("does not add a key for the entry with no model id", () => {
      const result = buildCustomModelDisplayNames({
        custom: makeProvider({
          provider: "custom",
          customModels: [{ displayName: "Orphan", mode: "chat" } as CustomModelEntry],
        }),
      });

      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});

describe("modelDisplayLabel()", () => {
  describe("given a configured display name for the model", () => {
    it("returns the display name", () => {
      const label = modelDisplayLabel("custom/gpt-5.1", {
        "custom/gpt-5.1": "Ada Prod Model",
      });

      expect(label).toBe("Ada Prod Model");
    });
  });

  describe("given a blank display name stored for the model", () => {
    it("falls back to the model id's family part instead of rendering blank", () => {
      // Pins `||` over `??`: a `??`-based implementation would return ""
      // here because the key IS present (not undefined) — only `||`
      // treats a blank string as "missing". `"" ?? "gpt-5.1"` is `""`.
      const label = modelDisplayLabel("custom/gpt-5.1", {
        "custom/gpt-5.1": "",
      });

      expect(label).toBe("gpt-5.1");
      expect(label).not.toBe("");
    });
  });

  describe("given no entry for the model in the map", () => {
    it("falls back to the model id's family part", () => {
      const label = modelDisplayLabel("openai/gpt-4o-mini", {
        "custom/gpt-5.1": "Ada Prod Model",
      });

      expect(label).toBe("gpt-4o-mini");
    });
  });

  describe("given no map at all", () => {
    it("falls back to the model id's family part", () => {
      const label = modelDisplayLabel("openai/gpt-4o-mini");

      expect(label).toBe("gpt-4o-mini");
    });
  });

  describe("given a custom entry normalized from the legacy string form, whose display name equals its model id", () => {
    /** @scenario A legacy custom model resolves to its model id */
    it("resolves to its model id", () => {
      const legacyEntries = toLegacyCompatibleCustomModels(["gpt-5.1"], "chat");
      const providers: Record<string, MaybeStoredModelProvider> = {
        custom: makeProvider({ provider: "custom", customModels: legacyEntries }),
      };

      const displayNames = buildCustomModelDisplayNames(providers);

      expect(modelDisplayLabel("custom/gpt-5.1", displayNames)).toBe("gpt-5.1");
    });
  });
});
