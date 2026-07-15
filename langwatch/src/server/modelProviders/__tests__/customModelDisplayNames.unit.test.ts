/**
 * Unit tests for the custom-model display-name resolver.
 *
 * Binds the two `@unit` scenarios in
 * specs/model-providers/custom-model-display-name.feature. The
 * `@integration` scenarios in the same file are bound against the
 * components that consume this resolver (ProviderModelSelector,
 * ModelChip, useModelSelectionOptions, etc.) — see their own test files.
 *
 * The malformed-entry cases below are not hypothetical: `customModels`
 * is a JSON column and `toLegacyCompatibleCustomModels` returns an
 * unchecked cast (customModel.schema.ts), so blank, whitespace-only and
 * field-missing entries can reach the resolver from a hand-edited row.
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
    describe("when display names are built for it", () => {
      it('keys the map by "<provider>/<modelId>"', () => {
        const result = buildCustomModelDisplayNames([
          makeProvider({
            provider: "custom",
            customModels: [
              {
                modelId: "gpt-5.1",
                displayName: "Ada Prod Model",
                mode: "chat",
              },
            ],
          }),
        ]);

        expect(result["custom/gpt-5.1"]).toBe("Ada Prod Model");
      });
    });
  });

  describe("given a chat model and an embeddings model on the same provider", () => {
    describe("when display names are built for them", () => {
      it("includes both in one map, regardless of mode", () => {
        const result = buildCustomModelDisplayNames([
          makeProvider({
            provider: "custom",
            customModels: [
              {
                modelId: "gpt-5.1",
                displayName: "Ada Prod Model",
                mode: "chat",
              },
            ],
            customEmbeddingsModels: [
              {
                modelId: "text-embed-3",
                displayName: "Ada Prod Embed",
                mode: "embedding",
              },
            ],
          }),
        ]);

        expect(result["custom/gpt-5.1"]).toBe("Ada Prod Model");
        expect(result["custom/text-embed-3"]).toBe("Ada Prod Embed");
      });
    });
  });

  describe("given the same provider stored at two scopes, each with its own custom model", () => {
    describe("when display names are built across both rows", () => {
      it("keeps both rows' models rather than letting one row win", () => {
        const result = buildCustomModelDisplayNames([
          makeProvider({
            provider: "openai",
            customModels: [
              { modelId: "org-tune", displayName: "Org Tune", mode: "chat" },
            ],
          }),
          makeProvider({
            provider: "openai",
            customModels: [
              {
                modelId: "proj-tune",
                displayName: "Project Tune",
                mode: "chat",
              },
            ],
          }),
        ]);

        expect(result["openai/org-tune"]).toBe("Org Tune");
        expect(result["openai/proj-tune"]).toBe("Project Tune");
      });
    });
  });

  describe("given custom entries whose display name is blank, whitespace-only, absent, or whose model id is absent", () => {
    const entries: CustomModelEntry[] = [
      { modelId: "gpt-5.1", displayName: "", mode: "chat" },
      { modelId: "gpt-5.2", displayName: "   ", mode: "chat" },
      { modelId: "gpt-5.3", mode: "chat" } as CustomModelEntry,
      { displayName: "Orphan", mode: "chat" } as CustomModelEntry,
    ];
    const providers = [
      makeProvider({ provider: "custom", customModels: entries }),
    ];

    describe("when display names are resolved for them", () => {
      /** @scenario A blank or incomplete custom entry falls back to the model id */
      it("resolves each entry that has a model id to that model id", () => {
        const displayNames = buildCustomModelDisplayNames(providers);

        expect(
          modelDisplayLabel({ fullModelId: "custom/gpt-5.1", displayNames }),
        ).toBe("gpt-5.1");
        expect(
          modelDisplayLabel({ fullModelId: "custom/gpt-5.2", displayNames }),
        ).toBe("gpt-5.2");
        expect(
          modelDisplayLabel({ fullModelId: "custom/gpt-5.3", displayNames }),
        ).toBe("gpt-5.3");
      });

      it("skips the entry with no model id", () => {
        const displayNames = buildCustomModelDisplayNames(providers);

        expect(Object.keys(displayNames)).not.toContain("custom/undefined");
      });

      it("never yields a blank or undefined name", () => {
        const displayNames = buildCustomModelDisplayNames(providers);

        for (const value of Object.values(displayNames)) {
          expect(value.trim()).toBeTruthy();
          expect(value).not.toBe("undefined");
        }
      });
    });
  });
});

describe("modelDisplayLabel()", () => {
  describe("given a configured display name for the model", () => {
    describe("when the label is resolved", () => {
      it("returns the display name", () => {
        const label = modelDisplayLabel({
          fullModelId: "custom/gpt-5.1",
          displayNames: { "custom/gpt-5.1": "Ada Prod Model" },
        });

        expect(label).toBe("Ada Prod Model");
      });
    });
  });

  describe("given a blank display name stored for the model", () => {
    describe("when the label is resolved", () => {
      it("falls back to the model id's family part instead of rendering blank", () => {
        // Pins `||` over `??`: a `??`-based implementation would return ""
        // here because the key IS present (not undefined) — only `||`
        // treats a blank string as "missing". `"" ?? "gpt-5.1"` is `""`.
        const label = modelDisplayLabel({
          fullModelId: "custom/gpt-5.1",
          displayNames: { "custom/gpt-5.1": "" },
        });

        expect(label).toBe("gpt-5.1");
        expect(label).not.toBe("");
      });
    });
  });

  describe("given no entry for the model in the map", () => {
    describe("when the label is resolved", () => {
      it("falls back to the model id's family part", () => {
        const label = modelDisplayLabel({
          fullModelId: "openai/gpt-4o-mini",
          displayNames: { "custom/gpt-5.1": "Ada Prod Model" },
        });

        expect(label).toBe("gpt-4o-mini");
      });
    });
  });

  describe("given no map at all", () => {
    describe("when the label is resolved", () => {
      it("falls back to the model id's family part", () => {
        const label = modelDisplayLabel({ fullModelId: "openai/gpt-4o-mini" });

        expect(label).toBe("gpt-4o-mini");
      });
    });
  });

  describe("given a custom entry normalized from the legacy string form, whose display name equals its model id", () => {
    describe("when the label is resolved", () => {
      /** @scenario A legacy custom model resolves to its model id */
      it("resolves to its model id", () => {
        const legacyEntries = toLegacyCompatibleCustomModels(
          ["gpt-5.1"],
          "chat",
        );
        const displayNames = buildCustomModelDisplayNames([
          makeProvider({ provider: "custom", customModels: legacyEntries }),
        ]);

        expect(
          modelDisplayLabel({ fullModelId: "custom/gpt-5.1", displayNames }),
        ).toBe("gpt-5.1");
      });
    });
  });
});
