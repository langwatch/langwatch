import type { CollectedBinding } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";

import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzReadRepository } from "../authz-read.repository";
import { AuthzService } from "../authz.service";
import { makeReader } from "./support/authz-read.stub";

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";

const projectScope = {
  type: "project",
  id: PROJECT,
  teamId: TEAM,
  organizationId: ORG,
} as const;

const key = { type: "apiKey", id: "key-1" } as const;

const projectBinding = (
  roleKey: CollectedBinding["roleKey"],
): CollectedBinding[] => [
  {
    roleKey,
    scopeType: "PROJECT",
    scopeId: PROJECT,
    viaGroupId: null,
  },
];

function makeAuthz(reader: AuthzReadRepository) {
  return new AuthzService(new AuthzCollectorService(reader));
}

describe("AuthzService and the api-key owner ceiling (ADR-092 §9)", () => {
  describe("given a key bound as admin whose owner is only a viewer", () => {
    const reader = () =>
      makeReader({
        findApiKeyOwner: vi.fn().mockResolvedValue({ userId: "dave" }),
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("admin")),
        findOrganizationMembership: vi
          .fn()
          .mockResolvedValue({ role: "MEMBER", disabled: false }),
        findUserBindings: vi.fn().mockResolvedValue(projectBinding("viewer")),
      });

    /** @scenario "An API key is capped by its owner's current grants" */
    it("denies a permission the key's own binding carries", async () => {
      const decision = await makeAuthz(reader()).check({
        principal: key,
        permission: "datasets:manage",
        scope: projectScope,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("owner-ceiling");
    });

    it("keeps a permission both the key and the owner hold", async () => {
      const decision = await makeAuthz(reader()).check({
        principal: key,
        permission: "traces:view",
        scope: projectScope,
      });

      expect(decision.allowed).toBe(true);
    });

    it("caps effectivePermissions to the intersection", async () => {
      const permissions = await makeAuthz(reader()).effectivePermissions({
        principal: key,
        scope: projectScope,
      });

      expect(permissions).toContain("traces:view");
      expect(permissions).not.toContain("datasets:manage");
    });

    it("returns the key's own snapshot from checkDetailed, not the owner's", async () => {
      const { grants } = await makeAuthz(reader()).checkDetailed({
        principal: key,
        permission: "traces:view",
        scope: projectScope,
      });

      expect(grants.principal).toEqual(key);
      expect(grants.organizationRole).toBeNull();
    });
  });

  describe("given a service key with no owner", () => {
    it("decides from the key's own grants alone", async () => {
      const reader = makeReader({
        findApiKeyOwner: vi.fn().mockResolvedValue({ userId: null }),
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("admin")),
      });

      const decision = await makeAuthz(reader).check({
        principal: key,
        permission: "datasets:manage",
        scope: projectScope,
      });

      expect(decision.allowed).toBe(true);
      expect(reader.findUserBindings).not.toHaveBeenCalled();
    });
  });

  describe("given a key id storage does not know", () => {
    it("decides from the key's own grants alone, like a service key", async () => {
      const reader = makeReader({
        findApiKeyOwner: vi.fn().mockResolvedValue(null),
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("admin")),
      });

      const decision = await makeAuthz(reader).check({
        principal: key,
        permission: "datasets:manage",
        scope: projectScope,
      });

      expect(decision.allowed).toBe(true);
    });
  });

  describe("given a user principal", () => {
    it("never looks for an owner", async () => {
      const reader = makeReader({
        findOrganizationMembership: vi
          .fn()
          .mockResolvedValue({ role: "MEMBER", disabled: false }),
        findUserBindings: vi.fn().mockResolvedValue(projectBinding("admin")),
      });

      const decision = await makeAuthz(reader).check({
        principal: { type: "user", id: "dave" },
        permission: "datasets:manage",
        scope: projectScope,
      });

      expect(decision.allowed).toBe(true);
      expect(reader.findApiKeyOwner).not.toHaveBeenCalled();
    });
  });

  describe("given an anonymous principal", () => {
    it("never looks for an owner", async () => {
      const reader = makeReader();

      const decision = await makeAuthz(reader).check({
        principal: { type: "anonymous" },
        permission: "traces:view",
        scope: projectScope,
      });

      expect(decision.allowed).toBe(false);
      expect(reader.findApiKeyOwner).not.toHaveBeenCalled();
    });
  });

  describe("given uncached grants during a cutover between two heads", () => {
    /** Head one says the key is admin and dave a viewer; head two says the
     *  key is a viewer and dave an admin. Either head alone denies
     *  datasets:manage; a key read from one head capped by an owner read
     *  from the other allows it. The route flips after the first pass. */
    function cutoverReader() {
      type Role = "admin" | "viewer";
      const head = (keyRole: Role, ownerRole: Role) =>
        makeReader({
          findApiKeyBindings: vi
            .fn()
            .mockResolvedValue(projectBinding(keyRole)),
          findOrganizationMembership: vi
            .fn()
            .mockResolvedValue({ role: "MEMBER", disabled: false }),
          findUserBindings: vi
            .fn()
            .mockResolvedValue(projectBinding(ownerRole)),
        });
      const heads = [head("admin", "viewer"), head("viewer", "admin")];
      let passes = 0;
      const beginPass = vi.fn(() => heads[Math.min(passes++, 1)]!);
      const root = makeReader({
        findApiKeyOwner: vi.fn().mockResolvedValue({ userId: "dave" }),
        findProjectLineage: vi
          .fn()
          .mockResolvedValue({ teamId: TEAM, organizationId: ORG }),
      });
      return { reader: { ...root, beginPass }, beginPass };
    }

    const uncached = {
      "the cache flag is off": { cacheEnabled: () => false },
      "the epoch store is unreachable": {
        cacheEnabled: () => true,
        epochReader: () => Promise.resolve(null),
      },
    } as const;

    for (const [when, options] of Object.entries(uncached)) {
      describe(`when ${when}`, () => {
        const seams = {
          check: async (authz: AuthzService) =>
            (
              await authz.check({
                principal: key,
                permission: "datasets:manage",
                scope: projectScope,
              })
            ).allowed,
          checkByIds: async (authz: AuthzService) =>
            (
              await authz.checkByIds({
                principal: key,
                permission: "datasets:manage",
                projectId: PROJECT,
              })
            ).allowed,
          canAnyByIds: async (authz: AuthzService) =>
            (
              await authz.canAnyByIds({
                principal: key,
                permissions: ["datasets:manage"],
                projectId: PROJECT,
              })
            ).allowed,
          canBatchPermissionsByIds: async (authz: AuthzService) =>
            (
              await authz.canBatchPermissionsByIds({
                principal: key,
                permissions: ["datasets:manage"],
                organizationId: ORG,
                teams: [],
                projects: [{ projectId: PROJECT, teamId: TEAM }],
              })
            ).byPermission
              .get("datasets:manage")
              ?.projects.get(PROJECT),
        };

        for (const [seam, ask] of Object.entries(seams)) {
          /** @scenario "An API key and its owner are read from one storage head when grants are not cached" */
          it(`${seam} reads the key and its owner off one pass`, async () => {
            const { reader, beginPass } = cutoverReader();
            const authz = new AuthzService(
              new AuthzCollectorService(reader),
              options,
            );

            expect(await ask(authz)).toBe(false);
            expect(beginPass).toHaveBeenCalledTimes(1);
          });
        }
      });
    }
  });
});
