import { describe, expect, it } from "vitest";
import { builtinRoleGrants } from "../src/roles";

const PERMISSION = "featureFlags:manageExperiments";

describe("built-in experiment management grants", () => {
  it("grants project administration only to the project admin role", () => {
    expect(builtinRoleGrants({ role: "admin", permission: PERMISSION })).toBe(true);
    expect(builtinRoleGrants({ role: "member", permission: PERMISSION })).toBe(false);
    expect(builtinRoleGrants({ role: "viewer", permission: PERMISSION })).toBe(false);
  });

  it("grants organization administration only to the organization admin role", () => {
    expect(builtinRoleGrants({ role: "org-admin", permission: PERMISSION })).toBe(true);
    expect(builtinRoleGrants({ role: "org-member", permission: PERMISSION })).toBe(false);
  });
});
