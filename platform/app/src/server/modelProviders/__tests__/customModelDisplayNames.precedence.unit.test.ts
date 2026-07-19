/**
 * Unit tests for how `buildCustomModelDisplayNames()` ranks ROWS against
 * each other — the `precedence` / `byPrecedence` half of the resolver.
 * The scope tier those functions consult is ranked by `rankOf` /
 * `scopeRank` and covered in `customModelDisplayNames.scopeRank.unit.test.ts`.
 *
 * Pinned for issue #5837, where a configured custom-model Display Name
 * silently failed to resolve in production. Two of the four ways the
 * function was lossy are this file's subject (labeled by the AC each now
 * guards — see the coverage map in
 * specs/model-providers/custom-model-display-name-resolution.feature):
 *
 *   AC2  — a legacy `string[]` row converted (via `toLegacyCompatibleCustomModels`)
 *        to an entry whose `displayName === modelId` (an "identity" entry)
 *        could clobber a real configured name on another row of the same
 *        provider.
 *   AC3  — two rows of the same provider each defining a REAL name for the
 *        same `modelId` resolved to whichever row the caller happened to
 *        list last, instead of a precedence rule.
 *
 * The contract this file pins:
 *   - Identity entries (`displayName.trim() === modelId`) are not names —
 *     they never enter the map and never compete with a real name.
 *   - When several rows supply a REAL name for the same `modelId`, the
 *     winner is decided, in order: (1) `enabled: true` beats `enabled:
 *     false`; (2) narrowest scope wins (see the scopeRank file); (3) a
 *     persisted row (one with an `id`) beats a synthesized one without;
 *     (4) lowest row `id` lexicographically, as a final total-order
 *     tiebreak.
 *
 * Each tier is pinned by a PAIR of cases — one listing the winner first,
 * one listing it last. Each case's own comment says which resolver bug the
 * pair's other half would otherwise hide.
 *
 * Some cases below (marked inline) already held correctly before this
 * change — they're kept as forward guards so a future change to this
 * contract can't regress them.
 */
import { describe, expect, it } from "vitest";
import { toLegacyCompatibleCustomModels } from "../customModel.schema";
import { buildCustomModelDisplayNames } from "../customModelDisplayNames";
import { makeProvider } from "./test-helpers";

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
