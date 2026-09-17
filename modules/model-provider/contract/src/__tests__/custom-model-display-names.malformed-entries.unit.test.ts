/** Guard that malformed JSON entries don't crash or leak keys (#5837 AC5b). */
import { describe, expect, it } from "vitest";
import type { CustomModelEntry } from "@langwatch/model-provider-contract";
import { buildCustomModelDisplayNames } from "@langwatch/model-provider-contract";
import { makeProvider } from "./model-provider.test-helpers.ts";

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
    // Guard mixed malformed and valid entries in the same array; valid entry is last
    // to catch loops that throw on first bad entry instead of continuing.
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
    // Guard whitespace-only model ids don't leak keys; requires trim() check, not just falsy.
    // Valid entry is last to catch loops that return on first rejected entry.
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
      expect(Object.keys(result).toSorted()).toEqual(["mp_ws/aurora-8", "vendorQ/aurora-8"]);
    });
  });
});
