/**
 * Unit tests for how `buildCustomModelDisplayNames()` ranks a row's SCOPE
 * — the `rankOf` / `scopeRank` half of the resolver, which feeds the
 * narrowest-scope tier of `precedence`. The tiers around it (enabled,
 * persisted, lowest id) are covered in
 * `customModelDisplayNames.precedence.unit.test.ts`.
 *
 * Pinned for issue #5837 (AC3 in the coverage map — see
 * specs/model-providers/custom-model-display-name-resolution.feature):
 * two rows of the same provider each defining a REAL name for the same
 * `modelId` resolved to whichever row the caller happened to list last,
 * instead of a precedence rule.
 *
 * The contract this file pins: narrowest scope wins — PROJECT > TEAM >
 * ORGANIZATION > none/unscoped/unrecognized (a scope tier this table
 * doesn't know ranks the same as `isSystem`), read from the `scopes[]`
 * grant set with the collapsed singular `scopeType` as the fallback.
 *
 * Every case here gives the LOSING row the lexicographically LOWER id, so
 * a resolver that failed to rank scope at all would fall through to the id
 * tiebreak and hand the key to the wrong row. That shape is what keeps
 * these cases honest: they cannot pass by accident on the tier below.
 */
import { describe, expect, it } from "vitest";
import { buildCustomModelDisplayNames } from "../customModelDisplayNames";
import { makeProvider } from "./test-helpers";

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

      const result = buildCustomModelDisplayNames([unknownTierRow, projectRow]);

      expect(result["vendorO/nova-6"]).toBe("Trusted Name");
    });
  });
});

describe("given a project-scoped row and a row whose scope tier names an inherited Object member", () => {
  describe("when display names are built across both rows", () => {
    // The case above pins an unrecognized tier that is ABSENT from the
    // rank table; this pins one that a membership test wrongly reports as
    // PRESENT. `"toString" in SCOPE_RANK` is `true` — `in` walks the
    // prototype chain — so an `in`-guarded lookup returns
    // `Object.prototype.toString`, a FUNCTION, and `Math.min` of a
    // function is `NaN`: exactly the `NaN` tier the guard exists to
    // prevent, re-opened one tier lower. `NaN` minus anything is falsy,
    // so the scope tier drops out of `byPrecedence` and this row — which
    // should rank last — instead falls through to the id tiebreak and
    // wins on its lower id. Only an own-property check ranks it as
    // unscoped. Every `Object.prototype` member is reachable this way;
    // `toString` stands in for `valueOf`, `constructor`, `hasOwnProperty`
    // and `__proto__`, cast in unchecked exactly as the unknown-tier case
    // above casts "WORKSPACE".
    //
    // Asserts the semantic property — the PROJECT row wins — rather than
    // order-independence, which the two cases above pin for their tiers:
    // with the prototype hole live the unranked row wins in BOTH orders,
    // so an order-independence assertion here would hold while the defect
    // stood and prove nothing. Verified by sabotage: restoring `in` turns
    // this red on the `toBe` alone.
    it("ranks a prototype-inherited scope tier last, so the project-scoped row's name wins", () => {
      const projectRow = makeProvider({
        provider: "vendorR",
        enabled: true,
        id: "zzz-project",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_8" }],
        customModels: [
          { modelId: "photon-9", displayName: "Scoped Winner", mode: "chat" },
        ],
      });
      const prototypeTierRow = makeProvider({
        provider: "vendorR",
        enabled: true,
        id: "aaa-prototype",
        scopes: [
          {
            scopeType: "toString" as unknown as
              | "ORGANIZATION"
              | "TEAM"
              | "PROJECT",
            scopeId: "proto_8",
          },
        ],
        customModels: [
          { modelId: "photon-9", displayName: "Prototype Leak", mode: "chat" },
        ],
      });

      const result = buildCustomModelDisplayNames([
        prototypeTierRow,
        projectRow,
      ]);

      expect(result["vendorR/photon-9"]).toBe("Scoped Winner");
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
