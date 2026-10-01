/**
 * The escalation rule over the real engine: what a caller lacks is read from
 * their effective permissions at the scope, so expiry and key ceilings apply.
 * @see specs/rbac/grants-rest-api.feature
 */
import { ALL_PERMISSIONS } from "@langwatch/authorization";
import { builtinRolePermissions, type CollectedBinding } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { makeReader } from "../../repositories/__tests__/support/authz-read.stub.ts";
import { AuthzService } from "../authz.service.ts";

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";
const USER = { type: "user" as const, id: "user-1" };
const KEY = { type: "apiKey" as const, id: "key-1" };

function authzFor({
  userBindings = [] as CollectedBinding[],
  keyBindings = [] as CollectedBinding[],
  keyOwner = null as string | null,
  membership = "MEMBER" as "ADMIN" | "MEMBER" | "EXTERNAL",
} = {}): AuthzService {
  return AuthzService.create({
    isOnEngine: async () => true,
    repository: makeReader({
      findOrganizationMembership: vi.fn().mockResolvedValue({ role: membership, disabled: false }),
      findUserBindings: vi.fn().mockResolvedValue(userBindings),
      findApiKeyBindings: vi.fn().mockResolvedValue(keyBindings),
      findApiKeyOwner: vi
        .fn()
        .mockResolvedValue(keyOwner ? { userId: keyOwner } : { userId: null }),
      findProjectLineage: vi.fn().mockResolvedValue({ teamId: TEAM, organizationId: ORG }),
      findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG }),
    }),
    listing: new StubAuthzListingRepository(),
    bindings: new StubAuthzManagedGrantRepository(),
  });
}

const on =
  (scopeType: CollectedBinding["scopeType"], scopeId: string) =>
  (roleKey: CollectedBinding["roleKey"], expiresAtMs?: number): CollectedBinding => ({
    roleKey,
    scopeType,
    scopeId,
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
  });
const onTeam = on("TEAM", TEAM);
const onProject = on("PROJECT", PROJECT);
const onOrganization = on("ORGANIZATION", ORG);

const role = (key: "admin" | "member" | "viewer") => [...builtinRolePermissions(key)];

describe("given a caller's own permissions bound what they may grant", () => {
  describe("when a member grants the member role on their own team", () => {
    /** @scenario Granting a role at the caller's own level is allowed */
    it("finds nothing beyond the caller", async () => {
      const authz = authzFor({ userBindings: [onTeam("member")] });

      const missing = await authz.findPermissionsBeyondCaller({
        organizationId: ORG,
        caller: USER,
        scope: { type: "team", id: TEAM },
        permissions: role("member"),
      });

      expect(missing).toEqual([]);
    });
  });

  describe("when a member grants the admin role on their team", () => {
    /** @scenario Changing a grant to a role above the caller's own is refused */
    it("names the admin permissions the member lacks", async () => {
      const authz = authzFor({ userBindings: [onTeam("member")] });

      const missing = await authz.findPermissionsBeyondCaller({
        organizationId: ORG,
        caller: USER,
        scope: { type: "team", id: TEAM },
        permissions: role("admin"),
      });

      expect(missing.length).toBeGreaterThan(0);
      expect(missing.every((permission) => !role("member").includes(permission))).toBe(true);
    });
  });

  describe("when the caller's admin grant on the team has expired", () => {
    /** @scenario An expired grant does not count towards what the caller holds */
    it("does not count the expired grant towards the admin role", async () => {
      const authz = authzFor({ userBindings: [onTeam("viewer"), onTeam("admin", 1)] });

      const missing = await authz.findPermissionsBeyondCaller({
        organizationId: ORG,
        caller: USER,
        scope: { type: "team", id: TEAM },
        permissions: role("admin"),
      });

      expect(missing.length).toBeGreaterThan(0);
    });
  });

  describe("when a key that holds one project grants on the organization", () => {
    /** @scenario An API key cannot grant beyond its own permissions and scope */
    it("finds every organization permission beyond the key, whatever its owner holds", async () => {
      const authz = authzFor({
        keyBindings: [onProject("member")],
        keyOwner: "owner-1",
        userBindings: [onOrganization("admin")],
        membership: "ADMIN",
      });

      const atOrganization = await authz.findPermissionsBeyondCaller({
        organizationId: ORG,
        caller: KEY,
        scope: { type: "organization", id: ORG },
        permissions: ["organization:view", "project:view"],
      });
      const onItsProject = await authz.findPermissionsBeyondCaller({
        organizationId: ORG,
        caller: KEY,
        scope: { type: "project", id: PROJECT },
        permissions: role("viewer").filter((permission) => permission.startsWith("project:")),
      });

      expect(atOrganization).toContain("organization:view");
      expect(onItsProject).toEqual([]);
    });
  });

  describe("when an organization admin grants anything", () => {
    it("finds nothing beyond the admin", async () => {
      const authz = authzFor({ userBindings: [onOrganization("admin")], membership: "ADMIN" });

      const missing = await authz.findPermissionsBeyondCaller({
        organizationId: ORG,
        caller: USER,
        scope: { type: "team", id: TEAM },
        permissions: [...ALL_PERMISSIONS],
      });

      expect(missing).toEqual([]);
    });
  });

  describe("when the scope belongs to another organization", () => {
    it("treats the caller as holding nothing there", async () => {
      const authz = authzFor({ userBindings: [onOrganization("admin")], membership: "ADMIN" });

      const missing = await authz.findPermissionsBeyondCaller({
        organizationId: "org-other",
        caller: USER,
        scope: { type: "team", id: TEAM },
        permissions: ["project:view"],
      });

      expect(missing).toEqual(["project:view"]);
    });
  });
});
