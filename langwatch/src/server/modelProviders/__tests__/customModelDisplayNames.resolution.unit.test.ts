/**
 * Unit tests for issue #5837 — `buildCustomModelDisplayNames()` is silently
 * lossy in production. Four defects, all reproduced at HEAD:
 *
 *   B  — a legacy `string[]` row converts (via `toLegacyCompatibleCustomModels`)
 *        to an entry whose `displayName === modelId` (an "identity" entry).
 *   C1/C2 — two rows of the same provider defining the same `modelId` resolve
 *        to whichever row the caller happens to list last: an identity entry
 *        can clobber a real configured name, and the winner flips with row
 *        order instead of being decided by any precedence rule.
 *   D  — the map is keyed `${provider}/${modelId}` only, so the canonical
 *        `${mpId}/${modelId}` form a caller may hold can never hit (#5828).
 *   E  — `entry?.displayName?.trim()` throws a TypeError when `displayName`
 *        is present but not a string, and spreading a non-array
 *        `customModels` column throws too — the column is JSON behind an
 *        unchecked cast (`toLegacyCompatibleCustomModels` returns one), so
 *        both shapes can reach here from a hand-edited or migrated row.
 *
 * Target contract this file pins (see PR description for the full writeup):
 *   - Identity entries (`displayName.trim() === modelId`) are not names —
 *     they never enter the map and never compete with a real name.
 *   - When several rows supply a REAL name for the same `modelId`, the
 *     winner is decided, in order: (1) `enabled: true` beats `enabled:
 *     false`; (2) narrowest scope wins — PROJECT > TEAM > ORGANIZATION >
 *     none/unscoped (including `isSystem`); (3) lowest row `id`
 *     lexicographically, as a final total-order tiebreak.
 *   - The map is dual-keyed: every real name is written under both
 *     `${provider}/${modelId}` and, when `row.id` exists,
 *     `${row.id}/${modelId}`.
 *   - A malformed entry or a malformed `customModels` column must not
 *     abort resolution for every other row.
 *
 * Some cases below (marked inline) already hold at HEAD — they're kept as
 * forward guards so the fix for the others can't regress them.
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

describe("given a real display name and a legacy identity row that collide on the same model id", () => {
  const realRow = makeProvider({
    provider: "custom",
    customModels: [
      { modelId: "gpt-5.1", displayName: "Marketing GPT-5.1", mode: "chat" },
    ],
  });
  const legacyRow = makeProvider({
    provider: "custom",
    customModels: toLegacyCompatibleCustomModels(["gpt-5.1"], "chat"),
  });

  describe("when the legacy row is returned last", () => {
    it("resolves the configured name when a legacy row is returned last", () => {
      const result = buildCustomModelDisplayNames([realRow, legacyRow]);

      expect(result["custom/gpt-5.1"]).toBe("Marketing GPT-5.1");
    });
  });

  describe("when the legacy row is returned first", () => {
    // At HEAD this order already resolves correctly — the real row is
    // processed last, so last-write-wins happens to land on it. Kept
    // alongside the "returned last" case above so the pair proves the
    // fix makes the outcome order-independent, not just luckier.
    it("resolves the configured name when a legacy row is returned first", () => {
      const result = buildCustomModelDisplayNames([legacyRow, realRow]);

      expect(result["custom/gpt-5.1"]).toBe("Marketing GPT-5.1");
    });
  });
});

describe("given an enabled row and a disabled row that both define the same model id", () => {
  describe("when display names are built across both rows", () => {
    it("prefers the enabled row's name over the disabled row's name", () => {
      // The disabled row deliberately has the narrower scope AND the
      // lexicographically lower id — both of which would make it win if
      // "enabled" weren't checked first. Only a correct enabled-tier
      // check makes this resolve to the enabled row's name.
      const enabledRow = makeProvider({
        provider: "vendorE",
        enabled: true,
        id: "zzz-enabled",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_1" }],
        customModels: [
          { modelId: "vault-9", displayName: "Verified Label", mode: "chat" },
        ],
      });
      const disabledRow = makeProvider({
        provider: "vendorE",
        enabled: false,
        id: "aaa-disabled",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_1" }],
        customModels: [
          { modelId: "vault-9", displayName: "Legacy Label", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([enabledRow, disabledRow]);

      expect(result["vendorE/vault-9"]).toBe("Verified Label");
    });
  });
});

describe("given a project-scoped row and an organization-scoped row that both define the same model id", () => {
  describe("when display names are built across both rows", () => {
    it("prefers the project-scoped row's name over the organization-scoped row's name", () => {
      // The organization-scoped row deliberately has the lexicographically
      // lower id, so this only resolves correctly if scope is checked
      // before falling through to the id tiebreak.
      const projectRow = makeProvider({
        provider: "vendorF",
        enabled: true,
        id: "zzz-project",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_2" }],
        customModels: [
          { modelId: "quasar-2", displayName: "Falcon Nine", mode: "chat" },
        ],
      });
      const organizationRow = makeProvider({
        provider: "vendorF",
        enabled: true,
        id: "aaa-org",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_2" }],
        customModels: [
          { modelId: "quasar-2", displayName: "Widget Nine", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([
        projectRow,
        organizationRow,
      ]);

      expect(result["vendorF/quasar-2"]).toBe("Falcon Nine");
    });
  });
});

describe("given two equally-eligible rows (same enabled state, same scope tier) that both define the same model id", () => {
  describe("when display names are built across both rows", () => {
    it("prefers the row with the lexicographically lowest id when every other tier ties", () => {
      const alphaRow = makeProvider({
        provider: "vendorG",
        enabled: true,
        id: "alpha-row",
        customModels: [
          {
            modelId: "zeta-service",
            displayName: "Customer Favorite",
            mode: "chat",
          },
        ],
      });
      const zuluRow = makeProvider({
        provider: "vendorG",
        enabled: true,
        id: "zulu-row",
        customModels: [
          {
            modelId: "zeta-service",
            displayName: "Internal Draft",
            mode: "chat",
          },
        ],
      });

      const result = buildCustomModelDisplayNames([alphaRow, zuluRow]);

      expect(result["vendorG/zeta-service"]).toBe("Customer Favorite");
    });
  });
});

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

describe("given a row whose custom entry has a non-string display name", () => {
  describe("when display names are built alongside a valid entry on another row", () => {
    it("resolves a valid entry on another row when this row's display name is a number", () => {
      const goodRow = makeProvider({
        provider: "vendorA",
        customModels: [
          {
            modelId: "beta-service",
            displayName: "Ops Assistant",
            mode: "chat",
          },
        ],
      });
      const badRow = makeProvider({
        provider: "vendorB",
        customModels: [
          { displayName: "Orphan Two", mode: "chat" } as CustomModelEntry,
          {
            modelId: "gamma-service",
            displayName: 42,
            mode: "chat",
          } as unknown as CustomModelEntry,
        ],
      });

      const result = buildCustomModelDisplayNames([goodRow, badRow]);

      expect(result["vendorA/beta-service"]).toBe("Ops Assistant");
    });
  });
});

describe("given a row whose custom models column is not an array", () => {
  describe("when display names are built alongside a valid entry on another row", () => {
    it("resolves a valid entry on another row when this row's custom models column is not an array", () => {
      const goodRow = makeProvider({
        provider: "vendorC",
        customModels: [
          {
            modelId: "delta-service",
            displayName: "Night Shift Ready",
            mode: "chat",
          },
        ],
      });
      const corruptRow = makeProvider({
        provider: "vendorD",
        customModels: { corrupted: true } as unknown as CustomModelEntry[],
      });

      const result = buildCustomModelDisplayNames([goodRow, corruptRow]);

      expect(result["vendorC/delta-service"]).toBe("Night Shift Ready");
    });
  });
});

describe("given a provider with only a legacy-converted custom model", () => {
  describe("when the display name is resolved", () => {
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

describe("given a whitespace-only display name on a narrower-scoped row and a real display name on a broader-scoped row for the same model id", () => {
  describe("when display names are built across both rows", () => {
    // Already holds at HEAD: today's blank/whitespace check is per-entry
    // and unconditional, so it never even reaches a scope comparison.
    // Kept as a forward guard — a precedence implementation that picks
    // "the winning row by tier, then reads its name" instead of "the
    // winning REAL name" would regress this by letting a blank-named
    // narrower row shadow a real broader one.
    it("resolves the broader-scoped row's real name over the narrower-scoped row's blank name", () => {
      const blankProjectRow = makeProvider({
        provider: "vendorH",
        enabled: true,
        id: "aaa-blank",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_3" }],
        customModels: [
          { modelId: "omega-vault", displayName: "   ", mode: "chat" },
        ],
      });
      const realOrganizationRow = makeProvider({
        provider: "vendorH",
        enabled: true,
        id: "zzz-real",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_3" }],
        customModels: [
          {
            modelId: "omega-vault",
            displayName: "Research Copilot",
            mode: "chat",
          },
        ],
      });

      const result = buildCustomModelDisplayNames([
        blankProjectRow,
        realOrganizationRow,
      ]);

      expect(result["vendorH/omega-vault"]).toBe("Research Copilot");
    });
  });
});

describe("given a custom model whose id is an alias-style latest pointer", () => {
  describe("when the display name is resolved", () => {
    // Already holds at HEAD — nothing in the current or target resolver
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
