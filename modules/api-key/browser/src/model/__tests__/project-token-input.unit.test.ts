// The /authorize page's token: the device-flow defaults capped at what the person holds.
// Spec: specs/api-keys/api-keys-v2.feature

import { defaultCliKeyPermissions } from "@langwatch/api-key-contract";
import { bindingScopeCanGrantPermission } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { getUserPermissionsAtScope } from "../api-key-permissions.ts";
import { cappedDeviceFlowPermissions, projectTokenInput } from "../project-token-input.ts";

const ORG = "org-1";

function heldOnProject(role: string) {
  return getUserPermissionsAtScope({
    myBindings: [{ scopeType: "TEAM", scopeId: "team-1", role }],
    scopeType: "PROJECT",
    scopeId: "alpha",
    organizationId: ORG,
    orgProjects: [{ id: "alpha", teamId: "team-1" }],
    isServiceKey: false,
  });
}

describe("given a team viewer on project alpha", () => {
  describe("when the authorize page mints a personal access token", () => {
    /** @scenario The authorize page mints the device-flow default set, capped at what the person holds */
    it("holds only the device-flow defaults the person holds, restricted to the project", () => {
      const held = heldOnProject("VIEWER");
      const permissions = cappedDeviceFlowPermissions({ held });
      const input = projectTokenInput({ organizationId: ORG, projectId: "alpha", permissions });

      expect(permissions.length).toBeGreaterThan(0);
      expect(permissions.every((permission) => held.includes(permission))).toBe(true);
      expect(permissions.length).toBeLessThan(defaultCliKeyPermissions().length);
      expect(input.permissionMode).toBe("restricted");
      expect(input.permissions).toEqual(permissions);
      expect(input.bindings).toEqual([{ role: "CUSTOM", scopeType: "PROJECT", scopeId: "alpha" }]);
    });
  });
});

describe("given an organization admin", () => {
  describe("when the authorize page caps the defaults", () => {
    it("keeps only permissions a project binding can grant", () => {
      const held = getUserPermissionsAtScope({
        myBindings: [{ scopeType: "ORGANIZATION", scopeId: ORG, role: "ADMIN" }],
        scopeType: "PROJECT",
        scopeId: "alpha",
        organizationId: ORG,
        orgProjects: [{ id: "alpha", teamId: "team-1" }],
        isServiceKey: false,
      });
      const permissions = cappedDeviceFlowPermissions({ held: [...held, "organization:view"] });

      expect(permissions.length).toBeGreaterThan(0);
      expect(
        permissions.every((permission) =>
          bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission }),
        ),
      ).toBe(true);
    });
  });
});

describe("given a person holding nothing on the project", () => {
  describe("when the cap is taken", () => {
    it("is empty, so no token is minted", () => {
      expect(cappedDeviceFlowPermissions({ held: [] })).toEqual([]);
    });
  });
});
