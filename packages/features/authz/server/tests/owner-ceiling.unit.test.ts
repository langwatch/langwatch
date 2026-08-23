import type { CollectedBinding } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";
import type { AuthzReadRepository } from "../src/repositories/authz-read.repository";
import { AuthzService } from "../src/services/authz.service";
import { StubAuthzListingRepository } from "./support/authz-listing.stub";
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

const projectBinding = (role: CollectedBinding["role"]): CollectedBinding[] => [
  {
    role,
    customRoleId: null,
    scopeType: "PROJECT",
    scopeId: PROJECT,
    viaGroupId: null,
  },
];

function makeAuthz(reader: AuthzReadRepository) {
  return AuthzService.create({
    repository: reader,
    listing: new StubAuthzListingRepository(),
  });
}

describe("AuthzService and the api-key owner ceiling (ADR-092 §9)", () => {
  describe("given a key bound as admin whose owner is only a viewer", () => {
    const reader = () =>
      makeReader({
        findApiKeyOwner: vi.fn().mockResolvedValue({ userId: "dave" }),
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
        findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
        findUserBindings: vi.fn().mockResolvedValue(projectBinding("VIEWER")),
      });

    /** @scenario "Permission decisions are unchanged by the package move" */
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
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
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
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
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
        findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
        findUserBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
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
});
