import { buildCustomModelDisplayNames } from "@langwatch/model-provider-contract";
/** Guard scope ranking and prototype-chain safety (#5837 AC3). */
import { describe, expect, it } from "vitest";

import { makeProvider } from "./model-provider.test-helpers.ts";

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
        customModels: [{ modelId: "quasar-2", displayName: "Falcon Nine", mode: "chat" }],
      });
      const organizationRow = makeProvider({
        provider: "vendorF",
        enabled: true,
        id: "aaa-org",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_2" }],
        customModels: [{ modelId: "quasar-2", displayName: "Widget Nine", mode: "chat" }],
      });

      const result = buildCustomModelDisplayNames([projectRow, organizationRow]);

      expect(result["vendorF/quasar-2"]).toBe("Falcon Nine");
    });
  });
});

describe("given a project-scoped row and an organization-scoped row whose winning row is returned last", () => {
  describe("when display names are built across both rows", () => {
    // Mirror of the prior case, with the winner (project-scoped) listed
    // first — stays green even with the precedence sort removed entirely,
    // verified by knocking the sort out. AC3 promises "either order";
    // together with the case above, this proves it for the scope tier.
    it("prefers the project-scoped row's name whichever order the rows arrive in", () => {
      const projectRow = makeProvider({
        provider: "vendorN",
        enabled: true,
        id: "zzz-project",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_5" }],
        customModels: [{ modelId: "comet-5", displayName: "Falcon Nine", mode: "chat" }],
      });
      const organizationRow = makeProvider({
        provider: "vendorN",
        enabled: true,
        id: "aaa-org",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org_5" }],
        customModels: [{ modelId: "comet-5", displayName: "Widget Nine", mode: "chat" }],
      });

      const result = buildCustomModelDisplayNames([organizationRow, projectRow]);

      expect(result["vendorN/comet-5"]).toBe("Falcon Nine");
    });
  });
});

describe("given a project-scoped row and a row whose scope tier is not one `rankOf` recognizes", () => {
  describe("when display names are built across both rows", () => {
    // Unknown tier has lower id; only scope ranking (not id tiebreak) makes project win.
    // "WORKSPACE" guards against unrecognized future tiers falling through.
    it("ranks the unrecognized scope tier last, so the project-scoped row's name wins", () => {
      const projectRow = makeProvider({
        provider: "vendorO",
        enabled: true,
        id: "zzz-project",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_6" }],
        customModels: [{ modelId: "nova-6", displayName: "Trusted Name", mode: "chat" }],
      });
      const unknownTierRow = makeProvider({
        provider: "vendorO",
        enabled: true,
        id: "aaa-unknown",
        scopes: [
          {
            scopeType: "WORKSPACE" as unknown as "ORGANIZATION" | "TEAM" | "PROJECT",
            scopeId: "ws_6",
          },
        ],
        customModels: [{ modelId: "nova-6", displayName: "Unranked Name", mode: "chat" }],
      });

      const result = buildCustomModelDisplayNames([unknownTierRow, projectRow]);

      expect(result["vendorO/nova-6"]).toBe("Trusted Name");
    });
  });
});

describe("given a project-scoped row and a row whose scope tier names an inherited Object member", () => {
  describe("when display names are built across both rows", () => {
    // Guard prototype-chain pollution: `in` operator returns true for inherited members,
    // causing NaN rank; only hasOwnProperty check prevents prototype tiers from winning.
    it("ranks a prototype-inherited scope tier last, so the project-scoped row's name wins", () => {
      const projectRow = makeProvider({
        provider: "vendorR",
        enabled: true,
        id: "zzz-project",
        scopes: [{ scopeType: "PROJECT", scopeId: "proj_8" }],
        customModels: [{ modelId: "photon-9", displayName: "Scoped Winner", mode: "chat" }],
      });
      const prototypeTierRow = makeProvider({
        provider: "vendorR",
        enabled: true,
        id: "aaa-prototype",
        scopes: [
          {
            scopeType: "toString" as unknown as "ORGANIZATION" | "TEAM" | "PROJECT",
            scopeId: "proto_8",
          },
        ],
        customModels: [{ modelId: "photon-9", displayName: "Prototype Leak", mode: "chat" }],
      });

      const result = buildCustomModelDisplayNames([prototypeTierRow, projectRow]);

      expect(result["vendorR/photon-9"]).toBe("Scoped Winner");
    });
  });
});

describe("given two rows scoped only via the legacy singular scopeType field (no scopes[] array)", () => {
  describe("when display names are built across both rows", () => {
    // Neither row sets `scopes[]`, so only `scopeRank`'s legacy fallback
    // branch (`: [row.scopeType]`) can rank them. The organization row
    // deliberately has the lexicographically LOWER id, so only a correct
    // read of that fallback — not the id tiebreak — makes the project row win.
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

      const result = buildCustomModelDisplayNames([organizationRow, projectRow]);

      expect(result["vendorP/pulsar-7"]).toBe("Legacy Field Winner");
    });
  });
});
