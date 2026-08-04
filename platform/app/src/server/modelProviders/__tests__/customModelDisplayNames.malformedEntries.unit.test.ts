/**
 * Unit tests for how `buildCustomModelDisplayNames()` survives MALFORMED
 * stored input — the `customEntriesOf` / `configuredDisplayName` guards.
 *
 * Pinned for issue #5837 (AC5b in the coverage map — see
 * specs/model-providers/custom-model-display-name-resolution.feature):
 * `entry?.displayName?.trim()` threw a TypeError when `displayName` was
 * present but not a string, and spreading a non-array `customModels`
 * column threw too.
 *
 * These shapes are not hypothetical. `customModels` and
 * `customEmbeddingsModels` are JSON columns, and
 * `toLegacyCompatibleCustomModels` returns `[]` for anything that is not an
 * array but casts the ELEMENTS through unchecked — so a hand-edited or
 * migrated row can reach the resolver holding an entry of any shape.
 *
 * The contract this file pins: a malformed entry or a malformed
 * `customModels` column must not abort resolution for every other row, and
 * must not key the map on an id no caller could ever hold.
 */
import { describe, expect, it } from "vitest";
import type { CustomModelEntry } from "../customModel.schema";
import { buildCustomModelDisplayNames } from "../customModelDisplayNames";
import { makeProvider } from "./test-helpers";

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

describe("given a row whose custom models array mixes malformed entries with a valid one", () => {
  describe("when display names are built for it", () => {
    // AC5b's own wording is "a customModels array containing one
    // malformed entry ... alongside valid entries" — entries sharing ONE
    // row's array. The two blocks above prove a related but different
    // property: a malformed row doesn't clobber a valid entry on ANOTHER
    // row. This is the same-row case AC5b actually specifies, covering
    // every malformed shape this JSON column can hold: a missing
    // `modelId`, a non-string `displayName`, a null `displayName`, a null
    // entry, and an entry that isn't even an object. The valid entry is
    // listed LAST so a naive loop that returns or throws on the first bad
    // entry — instead of skipping it and continuing — would also fail
    // this test.
    it("resolves the valid entry despite malformed entries earlier in the same array", () => {
      const row = makeProvider({
        provider: "vendorZ",
        id: "mp_1",
        customModels: [
          { displayName: "No Model Id", mode: "chat" }, // missing modelId
          { modelId: "m2", displayName: 42, mode: "chat" }, // non-string displayName
          { modelId: "m3", displayName: null, mode: "chat" }, // null displayName
          null, // null entry
          "a-bare-string", // wrong element type entirely
          { modelId: "m6", displayName: "Valid Name", mode: "chat" }, // the valid one, last
        ] as unknown as CustomModelEntry[],
      });

      // An uncaught throw here fails the test before the assertion below
      // runs — the same implicit proof of non-throwing the two malformed-
      // entry blocks above rely on, neither of which asserts it
      // separately either.
      const result = buildCustomModelDisplayNames([row]);

      expect(result["vendorZ/m6"]).toBe("Valid Name");
    });
  });
});

describe("given a row whose custom entry has a whitespace-only model id, alongside a valid entry", () => {
  describe("when display names are built for it", () => {
    // `customModelEntrySchema` declares `modelId: z.string().min(1)`, which
    // an all-whitespace id passes on length — it is three characters long —
    // and `toLegacyCompatibleCustomModels` casts the elements through
    // unchecked, so this shape reaches the resolver from a hand-edited or
    // migrated JSON row exactly like the malformed entries above.
    //
    // The entry's display name is REAL ("Ghost Model", not blank), so the
    // display-name guard cannot explain the ghost keys' absence — only a
    // model-id guard that rejects blank-after-trimming can. A falsy-only
    // guard (`!modelId`) lets "   " through and writes `vendorQ/   ` and
    // `mp_ws/   `: keys no caller can ever hold, since a full model id is
    // built from a real id. The row carries an `id` so BOTH key forms are
    // exercised — a guard covering only one would still leak the other.
    // The valid entry is listed LAST, so a loop that returned on the first
    // rejected entry instead of skipping it would fail the `toBe` too.
    it("keys the map by the valid entry alone, never by the whitespace-only model id", () => {
      const row = makeProvider({
        provider: "vendorQ",
        id: "mp_ws",
        customModels: [
          { modelId: "   ", displayName: "Ghost Model", mode: "chat" },
          { modelId: "aurora-8", displayName: "Aurora Eight", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([row]);

      expect(result["vendorQ/aurora-8"]).toBe("Aurora Eight");
      expect(result["mp_ws/aurora-8"]).toBe("Aurora Eight");
      // Asserts the whole key space positively rather than probing the ghost
      // keys for absence: a bare `toBeUndefined()` would also pass against a
      // map that came back empty for some unrelated reason.
      expect(Object.keys(result).sort()).toEqual([
        "mp_ws/aurora-8",
        "vendorQ/aurora-8",
      ]);
    });
  });
});
