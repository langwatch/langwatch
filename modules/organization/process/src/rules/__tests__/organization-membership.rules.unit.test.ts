/** @vitest-environment node */
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  isActiveAdmin,
  isAdminDemotion,
  isAssignableCustomRole,
  isLastAdmin,
} from "../organization-membership.rules.ts";

const { ADMIN, MEMBER } = OrganizationUserRole;

describe("isAdminDemotion", () => {
  it("is a demotion only when an admin leaves the admin seat", () => {
    expect(isAdminDemotion({ currentRole: ADMIN, role: MEMBER })).toBe(true);
    expect(isAdminDemotion({ currentRole: ADMIN, role: ADMIN })).toBe(false);
    expect(isAdminDemotion({ currentRole: MEMBER, role: ADMIN })).toBe(false);
    expect(isAdminDemotion({ currentRole: MEMBER, role: MEMBER })).toBe(false);
  });
});

describe("isActiveAdmin", () => {
  it("counts an admin who is not disabled", () => {
    expect(isActiveAdmin({ role: ADMIN, disabledAt: null })).toBe(true);
  });

  it("does not count a disabled admin, whichever time type disabled them", () => {
    expect(isActiveAdmin({ role: ADMIN, disabledAt: new Date(0) })).toBe(false);
    expect(
      isActiveAdmin({ role: ADMIN, disabledAt: Temporal.Instant.fromEpochMilliseconds(0) }),
    ).toBe(false);
  });

  it("does not count a member", () => {
    expect(isActiveAdmin({ role: MEMBER, disabledAt: null })).toBe(false);
  });
});

describe("isLastAdmin", () => {
  it("is the last admin at a count of one or none, not at two", () => {
    expect(isLastAdmin({ adminCount: 0 })).toBe(true);
    expect(isLastAdmin({ adminCount: 1 })).toBe(true);
    expect(isLastAdmin({ adminCount: 2 })).toBe(false);
  });
});

describe("isAssignableCustomRole", () => {
  const organizationId = "org_acme";

  it("assigns a custom role of the same organization", () => {
    const customRole = { kind: "custom", organizationId };
    expect(isAssignableCustomRole({ customRole, organizationId })).toBe(true);
  });

  it("refuses a missing role", () => {
    expect(isAssignableCustomRole({ customRole: null, organizationId })).toBe(false);
  });

  it("refuses another organization's role", () => {
    const customRole = { kind: "custom", organizationId: "org_elsewhere" };
    expect(isAssignableCustomRole({ customRole, organizationId })).toBe(false);
  });

  it("refuses a role with no organization", () => {
    const customRole = { kind: "custom", organizationId: null };
    expect(isAssignableCustomRole({ customRole, organizationId })).toBe(false);
  });

  it("refuses a role that is not user-created", () => {
    const customRole = { kind: "system", organizationId };
    expect(isAssignableCustomRole({ customRole, organizationId })).toBe(false);
  });
});
