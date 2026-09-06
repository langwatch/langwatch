/**
 * Unit tests for the KEY FORMS `buildCustomModelDisplayNames()` writes and
 * the LABEL `modelDisplayLabel()` resolves from them.
 *
 * Pinned for issue #5837 (AC4/AC5/AC6 in the coverage map — see
 * specs/model-providers/custom-model-display-name-resolution.feature).
 * AC4 is the lossy one this file's first block guards: the map was keyed
 * `${provider}/${modelId}` only, so the canonical `${mpId}/${modelId}` form
 * a caller may hold could never hit (#5828).
 *
 * The contract this file pins:
 *   - The map is dual-keyed: every real name is written under both
 *     `${provider}/${modelId}` and, when `row.id` exists,
 *     `${row.id}/${modelId}`.
 *   - A model with no configured name resolves to the id's family part —
 *     the same label every selector rendered before display names existed.
 *
 * Some cases below (marked inline) already held correctly before this
 * change — they're kept as forward guards so a future change to this
 * contract can't regress them.
 */
import { describe, expect, it } from "vitest";
import { toLegacyCompatibleCustomModels } from "../customModel.schema";
import {
  buildCustomModelDisplayNames,
  modelDisplayLabel,
} from "../customModelDisplayNames";
import { makeProvider } from "./test-helpers";

describe("given a custom model row identified by its row id", () => {
  const row = makeProvider({
    provider: "custom",
    id: "mp_123",
    customModels: [
      { modelId: "nightly-42", displayName: "Priority Alpha", mode: "chat" },
    ],
  });

  describe("when display names are built for it", () => {
    it("keys the map by the row id in addition to the provider", () => {
      const result = buildCustomModelDisplayNames([row]);

      expect(result["mp_123/nightly-42"]).toBe("Priority Alpha");
    });
  });

  describe("when the row-id-keyed full model id is resolved", () => {
    /** @scenario A canonical model-provider-id-prefixed id resolves the display name */
    it("resolves the row-id-keyed full model id without falling back to the raw id", () => {
      const displayNames = buildCustomModelDisplayNames([row]);

      const label = modelDisplayLabel({
        fullModelId: "mp_123/nightly-42",
        displayNames,
      });

      expect(label).toBe("Priority Alpha");
    });
  });
});

describe("given a provider with only a legacy-converted custom model", () => {
  describe("when the display name is resolved", () => {
    /** @scenario A legacy-only provider renders the same label as before display names existed */
    it("resolves to the model id's family part", () => {
      const legacyEntries = toLegacyCompatibleCustomModels(
        ["research-preview-7"],
        "chat",
      );
      const displayNames = buildCustomModelDisplayNames([
        makeProvider({
          provider: "legacyVendor",
          customModels: legacyEntries,
        }),
      ]);

      const label = modelDisplayLabel({
        fullModelId: "legacyVendor/research-preview-7",
        displayNames,
      });

      expect(label).toBe("research-preview-7");
    });
  });
});

describe("given an entry whose display name is only whitespace, with no other row competing for the same model id", () => {
  describe("when its label is resolved", () => {
    /** @scenario A whitespace-only display name falls back to the model id family */
    it("falls back to the model id's family part instead of the whitespace", () => {
      const row = makeProvider({
        provider: "vendorL",
        customModels: [
          { modelId: "nimbus-1", displayName: "   ", mode: "chat" },
        ],
      });

      const displayNames = buildCustomModelDisplayNames([row]);
      const label = modelDisplayLabel({
        fullModelId: "vendorL/nimbus-1",
        displayNames,
      });

      expect(label).toBe("nimbus-1");
      expect(label).not.toBe("");
    });
  });
});

describe("given a custom model whose id is an alias-style latest pointer", () => {
  describe("when the display name is resolved", () => {
    // This already held before this change — nothing in the resolver
    // special-cases modelId content. Kept as a forward guard so a future
    // implementation that manipulates fullModelId strings (e.g. splitting
    // on "/") doesn't trip over an id that itself reads like a pointer.
    it("resolves the configured name for the alias id", () => {
      const displayNames = buildCustomModelDisplayNames([
        makeProvider({
          provider: "vendorI",
          customModels: [
            {
              modelId: "latest",
              displayName: "Frontier Assistant",
              mode: "chat",
            },
          ],
        }),
      ]);

      const label = modelDisplayLabel({
        fullModelId: "vendorI/latest",
        displayNames,
      });

      expect(label).toBe("Frontier Assistant");
    });
  });
});
