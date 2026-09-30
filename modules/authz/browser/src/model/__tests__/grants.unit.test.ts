// How the Access tab reads a grant and which roles the grant dialog can offer.
// specs/rbac/roles-and-access-ui.feature

import { builtinRolePermissions } from "@langwatch/authz-contract";
import { currentTimeZone, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  expiryFromDay,
  grantPrincipalText,
  grantRoleOptions,
  grantScopeText,
  permissionsBeyondReader,
  rolePermissionsAt,
} from "../grants.ts";

const CUSTOM = [
  { id: "role_ops", name: "Ops", permissions: ["project:view", "project:delete"] },
  { id: "viewer", name: "Shadow viewer", permissions: [] },
];

describe("the grant dialog's roles", () => {
  /** @scenario The built-in roles are always offered first, once */
  it("puts Admin, Member and Viewer first, each once, then the custom roles", () => {
    expect(grantRoleOptions({ customRoles: CUSTOM })).toEqual([
      { id: "admin", name: "Admin", builtIn: true },
      { id: "member", name: "Member", builtIn: true },
      { id: "viewer", name: "Viewer", builtIn: true },
      { id: "role_ops", name: "Ops", builtIn: false },
    ]);
  });

  it("reads a custom role's permissions as they are, at any scope", () => {
    expect(
      rolePermissionsAt({ roleId: "role_ops", scopeType: "team", customRoles: CUSTOM }),
    ).toEqual(["project:view", "project:delete"]);
  });

  it("reads a built-in role below the organization from the contract", () => {
    expect(
      rolePermissionsAt({ roleId: "member", scopeType: "project", customRoles: CUSTOM }),
    ).toEqual([...builtinRolePermissions("member")]);
  });

  it("cannot say what a built-in role confers on the organization", () => {
    expect(
      rolePermissionsAt({ roleId: "admin", scopeType: "organization", customRoles: CUSTOM }),
    ).toBeNull();
  });
});

describe("what the reader cannot hand on", () => {
  /** @scenario A role beyond the reader's own access is greyed out */
  it("names the permissions the reader does not hold", () => {
    expect(
      permissionsBeyondReader({
        requested: ["project:view", "project:delete"],
        held: ["project:view"],
      }),
    ).toEqual(["project:delete"]);
  });

  it("counts an action as held when its manage is", () => {
    expect(
      permissionsBeyondReader({ requested: ["project:view"], held: ["project:manage"] }),
    ).toEqual([]);
  });
});

describe("a grant row", () => {
  it("names the scope in full, falling back to its id", () => {
    expect(grantScopeText({ type: "team", id: "team-1", name: "Platform" })).toBe(
      "Team · Platform",
    );
    expect(grantScopeText({ type: "project", id: "proj-1", name: null })).toBe("Project · proj-1");
  });

  it("names a holder with no name by what it is", () => {
    expect(grantPrincipalText({ type: "group", id: "g1", name: null })).toBe("Unknown group");
    expect(grantPrincipalText({ type: "apiKey", id: "k1", name: null })).toBe(
      "An API key with no name yet",
    );
  });

  it("ends a picked day at its last second, and an empty pick never", () => {
    const endOfDay =
      Temporal.PlainDateTime.from("2026-12-31T23:59:59").toZonedDateTime(currentTimeZone());

    expect(expiryFromDay("2026-12-31")?.epochMilliseconds).toBe(endOfDay.epochMilliseconds);
    expect(expiryFromDay("")).toBeUndefined();
  });
});
