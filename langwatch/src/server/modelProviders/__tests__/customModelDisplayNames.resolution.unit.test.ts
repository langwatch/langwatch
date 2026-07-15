/**
 * Unit tests for `buildCustomModelDisplayNames()`'s resolution contract —
 * pinned for issue #5837, where a configured custom-model Display Name
 * silently failed to resolve in production. Before this change, the
 * function was lossy in four ways (labeled by the AC each now guards —
 * see the coverage map in
 * specs/model-providers/custom-model-display-name-resolution.feature):
 *
 *   AC2  — a legacy `string[]` row converted (via `toLegacyCompatibleCustomModels`)
 *        to an entry whose `displayName === modelId` (an "identity" entry)
 *        could clobber a real configured name on another row of the same
 *        provider.
 *   AC3  — two rows of the same provider each defining a REAL name for the
 *        same `modelId` resolved to whichever row the caller happened to
 *        list last, instead of a precedence rule.
 *   AC4  — the map was keyed `${provider}/${modelId}` only, so the canonical
 *        `${mpId}/${modelId}` form a caller may hold could never hit (#5828).
 *   AC5b — `entry?.displayName?.trim()` threw a TypeError when `displayName`
 *        was present but not a string, and spreading a non-array
 *        `customModels` column threw too — the column is JSON behind an
 *        unchecked cast (`toLegacyCompatibleCustomModels` returns one), so
 *        both shapes can reach here from a hand-edited or migrated row.
 *
 * The contract this file pins:
 *   - Identity entries (`displayName.trim() === modelId`) are not names —
 *     they never enter the map and never compete with a real name.
 *   - When several rows supply a REAL name for the same `modelId`, the
 *     winner is decided, in order: (1) `enabled: true` beats `enabled:
 *     false`; (2) narrowest scope wins — PROJECT > TEAM > ORGANIZATION >
 *     none/unscoped/unrecognized (a scope tier this table doesn't know
 *     ranks the same as `isSystem`); (3) a persisted row (one with an
 *     `id`) beats a synthesized one without; (4) lowest row `id`
 *     lexicographically, as a final total-order tiebreak.
 *   - The map is dual-keyed: every real name is written under both
 *     `${provider}/${modelId}` and, when `row.id` exists,
 *     `${row.id}/${modelId}`.
 *   - A malformed entry or a malformed `customModels` column must not
 *     abort resolution for every other row.
 *
 * Some cases below (marked inline) already held correctly before this
 * change — they're kept as forward guards so a future change to this
 * contract can't regress them.
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
    // This order resolves correctly even without the identity-skip rule:
    // both rows tie on every precedence tier here (no id, no scope), so
    // the stable sort leaves them in arrival order and the real row —
    // listed first in this call — wins the first-write-wins map
    // regardless of whether the legacy row's identity entry was ever
    // skipped. Kept alongside the "returned first" case below, which is
    // the one that actually exercises the identity-skip rule, so
    // together the pair proves the fix is order-independent rather than
    // resting on one lucky order.
    /** @scenario A legacy row of the same provider does not clobber a configured name */
    it("resolves the configured name when a legacy row is returned last", () => {
      const result = buildCustomModelDisplayNames([realRow, legacyRow]);

      expect(result["custom/gpt-5.1"]).toBe("Marketing GPT-5.1");
    });
  });

  describe("when the legacy row is returned first", () => {
    // This is the case that actually exercises the identity-skip rule:
    // with every precedence tier tied, the stable sort leaves the legacy
    // row first, so only skipping its identity entry (`displayName ===
    // modelId`) stops it from writing "gpt-5.1" ahead of the real row's
    // configured name. Drop that skip and only this ordering goes red —
    // verified by sabotage.
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

describe("given an enabled row and a disabled row whose winning row is returned last", () => {
  describe("when display names are built across both rows", () => {
    // The mirror of "given an enabled row and a disabled row..." above,
    // which lists its winner (the enabled row) first and so stays green
    // even with the precedence sort removed entirely (arrival-order-wins)
    // — verified by knocking the sort out. Only the pair together pins
    // the enabled tier rather than arrival order.
    it("prefers the enabled row's name whichever order the rows arrive in", () => {
      // Same discriminating shape as the case above: the disabled row
      // has both the narrower scope and the lower id, so only a correct
      // enabled-tier check — not scope, not id — explains the enabled
      // row winning here too.
      const enabledRow = makeProvider({
        provider: "vendorM",
        enabled: true,
        id: "zzz-enabled",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_4" }],
        customModels: [
          { modelId: "sigma-4", displayName: "Verified Label", mode: "chat" },
        ],
      });
      const disabledRow = makeProvider({
        provider: "vendorM",
        enabled: false,
        id: "aaa-disabled",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_4" }],
        customModels: [
          { modelId: "sigma-4", displayName: "Legacy Label", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([disabledRow, enabledRow]);

      expect(result["vendorM/sigma-4"]).toBe("Verified Label");
    });
  });
});

describe("given a project-scoped row and an organization-scoped row that both define the same model id", () => {
  describe("when display names are built across both rows", () => {
    /** @scenario Two rows with distinct configured names resolve to one deterministic winner */
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

describe("given a project-scoped row and an organization-scoped row whose winning row is returned last", () => {
  describe("when display names are built across both rows", () => {
    // The mirror of "given a project-scoped row and an organization-scoped
    // row..." above, which lists its winner (the project-scoped row)
    // first and so stays green even with the precedence sort removed
    // entirely (arrival-order-wins) — verified by knocking the sort out.
    // AC3's scenario promises the winner resolves "in either order";
    // together with the case above, this pair proves that for the scope
    // tier specifically, not just for the id tiebreak below.
    it("prefers the project-scoped row's name whichever order the rows arrive in", () => {
      const projectRow = makeProvider({
        provider: "vendorN",
        enabled: true,
        id: "zzz-project",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_5" }],
        customModels: [
          { modelId: "comet-5", displayName: "Falcon Nine", mode: "chat" },
        ],
      });
      const organizationRow = makeProvider({
        provider: "vendorN",
        enabled: true,
        id: "aaa-org",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_5" }],
        customModels: [
          { modelId: "comet-5", displayName: "Widget Nine", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([
        organizationRow,
        projectRow,
      ]);

      expect(result["vendorN/comet-5"]).toBe("Falcon Nine");
    });
  });
});

describe("given a project-scoped row and a row whose scope tier is not one `rankOf` recognizes", () => {
  describe("when display names are built across both rows", () => {
    // The unknown-tier row deliberately has the lexicographically LOWER
    // id, so only a correct scope ranking can make the project-scoped
    // row win: if the unknown tier fell through to the id tiebreak
    // instead of ranking last, this row would win on id alone and the
    // test would pass for the wrong reason. "WORKSPACE" stands in for a
    // future tier, cast in unchecked the same way
    // `modelProvider.service.ts` launders the Prisma enum with `as` —
    // `registry.ts`'s `scopes[].scopeType` is typed as the known union,
    // so reaching an unrecognized value here requires the same kind of
    // cast a real caller would need to smuggle one past the type system.
    it("ranks the unrecognized scope tier last, so the project-scoped row's name wins", () => {
      const projectRow = makeProvider({
        provider: "vendorO",
        enabled: true,
        id: "zzz-project",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_6" }],
        customModels: [
          { modelId: "nova-6", displayName: "Trusted Name", mode: "chat" },
        ],
      });
      const unknownTierRow = makeProvider({
        provider: "vendorO",
        enabled: true,
        id: "aaa-unknown",
        scopes: [
          {
            scopeType: "WORKSPACE" as unknown as
              | "ORGANIZATION"
              | "TEAM"
              | "PROJECT",
            scopeId: "ws_6",
          },
        ],
        customModels: [
          { modelId: "nova-6", displayName: "Unranked Name", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([
        unknownTierRow,
        projectRow,
      ]);

      expect(result["vendorO/nova-6"]).toBe("Trusted Name");
    });
  });
});

describe("given two rows scoped only via the legacy singular scopeType field (no scopes[] array)", () => {
  describe("when display names are built across both rows", () => {
    // `registry.ts` keeps the collapsed `scopeType`/`scopeId` pair "for
    // legacy callers that still key by scopeType/scopeId" alongside the
    // plural `scopes[]` grant set every other scoped fixture in this file
    // uses. Neither row here sets `scopes`, so `scopeRank`'s fallback
    // branch (`: [row.scopeType]`) is the only thing that can rank them.
    // The organization row deliberately has the lexicographically LOWER
    // id, so only a correct read of that fallback branch — not the id
    // tiebreak — can make the project row win.
    it("prefers the project-scoped row's name over the organization-scoped row's name", () => {
      const projectRow = makeProvider({
        provider: "vendorP",
        enabled: true,
        id: "zzz-project",
        scopeType: "PROJECT",
        scopeId: "proj_7",
        customModels: [
          {
            modelId: "pulsar-7",
            displayName: "Legacy Field Winner",
            mode: "chat",
          },
        ],
      });
      const organizationRow = makeProvider({
        provider: "vendorP",
        enabled: true,
        id: "aaa-org",
        scopeType: "ORGANIZATION",
        scopeId: "org_7",
        customModels: [
          {
            modelId: "pulsar-7",
            displayName: "Legacy Field Loser",
            mode: "chat",
          },
        ],
      });

      const result = buildCustomModelDisplayNames([
        organizationRow,
        projectRow,
      ]);

      expect(result["vendorP/pulsar-7"]).toBe("Legacy Field Winner");
    });
  });
});

describe("given a persisted row and a row with no id that both define the same model id", () => {
  describe("when display names are built across both rows", () => {
    it("prefers the persisted row's name over the name on the row with no id", () => {
      // Neither row carries scopes, so the enabled and scope tiers tie and
      // the id tiebreak alone would hand this to the id-less row — an absent
      // id sorts below every real one. Only a persisted tier ahead of that
      // tiebreak keeps a synthesized placeholder from outranking a stored row.
      const placeholderRow = makeProvider({
        provider: "vendorJ",
        enabled: true,
        customModels: [
          {
            modelId: "helix-3",
            displayName: "Seeded Placeholder",
            mode: "chat",
          },
        ],
      });
      const persistedRow = makeProvider({
        provider: "vendorJ",
        enabled: true,
        id: "mp_stored",
        customModels: [
          { modelId: "helix-3", displayName: "Stored Label", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([
        placeholderRow,
        persistedRow,
      ]);

      expect(result["vendorJ/helix-3"]).toBe("Stored Label");
    });
  });
});

describe("given a persisted row and a row with no id whose winning row is returned first", () => {
  describe("when display names are built across both rows", () => {
    // The mirror of "given a persisted row and a row with no id..."
    // above, which lists its winner (the persisted row) LAST — the order
    // plain last-write-wins (the exact pre-fix production code this PR
    // replaces) also resolves correctly, since the winner being last is
    // exactly what last-write-wins rewards. That makes the case above
    // pass for the wrong reason: it can't tell a correct persisted-tier
    // rule from an incorrect last-write-wins rule. Swapping the order —
    // winner first, loser last, as below — flips that: only a real
    // persisted-tier rule still resolves the winner, while last-write-wins
    // hands it to the loser. Verified by sabotage.
    it("prefers the persisted row's name whichever order the rows arrive in", () => {
      // Same discriminating shape as the case above: neither row carries
      // scopes, so the enabled and scope tiers tie and the id tiebreak
      // alone would hand this to the id-less row — an absent id sorts
      // below every real one. Only a persisted tier ahead of that
      // tiebreak keeps a synthesized placeholder from outranking a
      // stored row, regardless of arrival order.
      const placeholderRow = makeProvider({
        provider: "vendorJ",
        enabled: true,
        customModels: [
          {
            modelId: "helix-3",
            displayName: "Seeded Placeholder",
            mode: "chat",
          },
        ],
      });
      const persistedRow = makeProvider({
        provider: "vendorJ",
        enabled: true,
        id: "mp_stored",
        customModels: [
          { modelId: "helix-3", displayName: "Stored Label", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([
        persistedRow,
        placeholderRow,
      ]);

      expect(result["vendorJ/helix-3"]).toBe("Stored Label");
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

describe("given two equally-eligible rows whose lexicographically lowest id is returned last", () => {
  describe("when display names are built across both rows", () => {
    // The mirror of the case above, which lists its winner first and so
    // stays green against a resolver with no tiebreak at all (plain
    // first-write-wins) — verified by knocking the tiebreak out. Only the
    // pair together pins an id rank rather than an arrival order.
    it("prefers the lexicographically lowest id whichever order the rows arrive in", () => {
      const alphaRow = makeProvider({
        provider: "vendorK",
        enabled: true,
        id: "alpha-row",
        customModels: [
          { modelId: "orbit-7", displayName: "Chosen Name", mode: "chat" },
        ],
      });
      const zuluRow = makeProvider({
        provider: "vendorK",
        enabled: true,
        id: "zulu-row",
        customModels: [
          { modelId: "orbit-7", displayName: "Other Name", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([zuluRow, alphaRow]);

      expect(result["vendorK/orbit-7"]).toBe("Chosen Name");
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

describe("given a row whose custom entry has a non-string display name", () => {
  describe("when display names are built alongside a valid entry on another row", () => {
    /** @scenario A malformed entry is skipped without breaking valid ones */
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

describe("given a whitespace-only display name on a narrower-scoped row and a real display name on a broader-scoped row for the same model id", () => {
  describe("when display names are built across both rows", () => {
    // This already held before this change: the blank/whitespace check is
    // per-entry and unconditional, so it never even reaches a scope
    // comparison. Kept as a forward guard — a precedence implementation
    // that picks "the winning row by tier, then reads its name" instead
    // of "the winning REAL name" would regress this by letting a
    // blank-named narrower row shadow a real broader one.
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
