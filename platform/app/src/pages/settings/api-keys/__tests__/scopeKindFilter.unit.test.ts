import { describe, expect, it } from "vitest";

import {
  ALL_SCOPE_KINDS,
  buildScopeKindChips,
  filterKeysByScopeKind,
  isApiKeyScopeKind,
  keyMatchesScopeKind,
} from "../scopeKindFilter";

/**
 * Unit tests for specs/api-keys/api-keys-credentials-table.feature — the
 * scope-kind chips above the credentials table.
 */

function keyBoundTo(...scopeTypes: string[]) {
  return {
    roleBindings: scopeTypes.map((scopeType, index) => ({
      scopeType,
      scopeId: `${scopeType.toLowerCase()}-${index}`,
    })),
  };
}

const ORG_KEY = keyBoundTo("ORGANIZATION");
const TEAM_KEY = keyBoundTo("TEAM");
const PROJECT_KEY = keyBoundTo("PROJECT");
const ORG_AND_PROJECT_KEY = keyBoundTo("ORGANIZATION", "PROJECT");

describe("keyMatchesScopeKind", () => {
  describe("given the all-keys filter", () => {
    describe("when a key has no bindings at all", () => {
      it("keeps the key", () => {
        expect(keyMatchesScopeKind({ roleBindings: [] }, ALL_SCOPE_KINDS)).toBe(
          true,
        );
      });
    });
  });

  describe("given a single-level filter", () => {
    describe("when the key is bound at that level", () => {
      it("keeps the key", () => {
        expect(keyMatchesScopeKind(TEAM_KEY, "TEAM")).toBe(true);
      });
    });

    describe("when the key is bound at a different level", () => {
      it("drops the key", () => {
        expect(keyMatchesScopeKind(TEAM_KEY, "PROJECT")).toBe(false);
      });
    });
  });

  describe("given a key bound at two levels", () => {
    describe("when either of those levels is picked", () => {
      /** @scenario A key bound at two levels is counted and shown under both */
      it("keeps the key under both levels", () => {
        expect(keyMatchesScopeKind(ORG_AND_PROJECT_KEY, "ORGANIZATION")).toBe(
          true,
        );
        expect(keyMatchesScopeKind(ORG_AND_PROJECT_KEY, "PROJECT")).toBe(true);
      });
    });

    describe("when a level it is not bound at is picked", () => {
      it("drops the key", () => {
        expect(keyMatchesScopeKind(ORG_AND_PROJECT_KEY, "TEAM")).toBe(false);
      });
    });
  });
});

describe("filterKeysByScopeKind", () => {
  describe("given keys at every level", () => {
    describe("when the all-keys filter is active", () => {
      it("returns every key", () => {
        const keys = [ORG_KEY, TEAM_KEY, PROJECT_KEY];
        expect(filterKeysByScopeKind(keys, ALL_SCOPE_KINDS)).toHaveLength(3);
      });
    });

    describe("when one level is picked", () => {
      /** @scenario Picking a level shows only the keys bound at that level */
      it("returns only the keys bound at that level", () => {
        const keys = [ORG_KEY, TEAM_KEY, PROJECT_KEY, ORG_AND_PROJECT_KEY];
        expect(filterKeysByScopeKind(keys, "PROJECT")).toEqual([
          PROJECT_KEY,
          ORG_AND_PROJECT_KEY,
        ]);
      });
    });
  });
});

describe("buildScopeKindChips", () => {
  describe("given keys at every level", () => {
    describe("when the chips are built", () => {
      /** @scenario The chip row counts the keys at each level of the organization */
      it("counts every key under all-keys and each level under its own chip", () => {
        const keys = [
          ORG_KEY,
          ORG_KEY,
          TEAM_KEY,
          PROJECT_KEY,
          PROJECT_KEY,
          PROJECT_KEY,
        ];

        expect(buildScopeKindChips(keys)).toEqual([
          { value: "all", label: "All keys", count: 6 },
          { value: "ORGANIZATION", label: "Organization", count: 2 },
          { value: "TEAM", label: "Team", count: 1 },
          { value: "PROJECT", label: "Project", count: 3 },
        ]);
      });

      /** @scenario Counts describe the rows on screen, not the whole organization */
      it("gives every chip a count equal to the rows picking it would leave", () => {
        const keys = [ORG_KEY, TEAM_KEY, PROJECT_KEY, ORG_AND_PROJECT_KEY];

        for (const chip of buildScopeKindChips(keys)) {
          expect(filterKeysByScopeKind(keys, chip.value as never)).toHaveLength(
            chip.count,
          );
        }
      });
    });
  });

  describe("given every key sits on a project", () => {
    describe("when the chips are built", () => {
      /** @scenario A level with no keys gets no chip */
      it("offers no chip for the levels holding nothing", () => {
        const chips = buildScopeKindChips([PROJECT_KEY, PROJECT_KEY]);
        expect(chips.map((chip) => chip.value)).toEqual(["all", "PROJECT"]);
      });
    });
  });

  describe("given there are no keys", () => {
    describe("when the chips are built", () => {
      it("offers the all-keys chip alone, at zero", () => {
        expect(buildScopeKindChips([])).toEqual([
          { value: "all", label: "All keys", count: 0 },
        ]);
      });
    });
  });
});

describe("isApiKeyScopeKind", () => {
  describe("given a value that is not a scope kind", () => {
    describe("when it is checked", () => {
      it("rejects it", () => {
        expect(isApiKeyScopeKind("PRINCIPAL")).toBe(false);
        expect(isApiKeyScopeKind("all")).toBe(false);
      });
    });
  });

  describe("given each of the three levels", () => {
    describe("when they are checked", () => {
      it("accepts them", () => {
        expect(isApiKeyScopeKind("ORGANIZATION")).toBe(true);
        expect(isApiKeyScopeKind("TEAM")).toBe(true);
        expect(isApiKeyScopeKind("PROJECT")).toBe(true);
      });
    });
  });
});
