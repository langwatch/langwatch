/**
 * @vitest-environment node
 * The organization doors' pre-write ceiling: what it asks authz, and what it refuses unasked.
 * @see specs/rbac/grants-rest-api.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import { OrganizationGrantCeilingService } from "../organization-grant-ceiling.service.ts";

const ORGANIZATION_ID = "org-1";

function ceiling({ missing = [] }: { missing?: string[] } = {}) {
  const findPermissionsBeyondCaller = vi.fn<AuthzApi["findPermissionsBeyondCaller"]>(
    async () => missing,
  );
  const findRolePermissions = vi.fn<AuthzApi["findRolePermissions"]>(async () => [
    { id: "role-auditor", name: "Auditor", permissions: ["traces:view", "team:manage"] },
  ]);

  return {
    findPermissionsBeyondCaller,
    findRolePermissions,
    service: OrganizationGrantCeilingService.create({
      findPermissionsBeyondCaller,
      findRolePermissions,
    }),
  };
}

describe("given a grant naming a custom role", () => {
  /** @scenario Saving a team's members with a role above the caller is refused */
  it("asks authz for exactly that role's permissions at the grant's own scope", async () => {
    const { service, findPermissionsBeyondCaller } = ceiling();

    await service.assertWithinCaller({
      organizationId: ORGANIZATION_ID,
      caller: { type: "user", id: "lead" },
      grants: [
        { role: "CUSTOM", customRoleId: "role-auditor", scopeType: "TEAM", scopeId: "team-1" },
      ],
    });

    expect(findPermissionsBeyondCaller).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      caller: { type: "user", id: "lead" },
      scope: { type: "team", id: "team-1" },
      permissions: ["traces:view", "team:manage"],
    });
  });

  /** @scenario A custom role the organization does not have is refused before anything is written */
  it("refuses a role authz does not know, rather than reading it as conferring nothing", async () => {
    const { service, findPermissionsBeyondCaller } = ceiling();

    await expect(
      service.assertWithinCaller({
        organizationId: ORGANIZATION_ID,
        caller: { type: "user", id: "lead" },
        grants: [
          { role: "CUSTOM", customRoleId: "role-gone", scopeType: "TEAM", scopeId: "team-1" },
        ],
      }),
    ).rejects.toMatchObject({ code: "custom_role_not_assignable" });
    expect(findPermissionsBeyondCaller).not.toHaveBeenCalled();
  });
});

describe("given a grant write nobody answers for", () => {
  /** @scenario A grant write nobody answers for is refused */
  it("refuses every conferred permission without asking authz", async () => {
    const { service, findPermissionsBeyondCaller } = ceiling();

    await expect(
      service.assertWithinCaller({
        organizationId: ORGANIZATION_ID,
        caller: { type: "anonymous" },
        grants: [
          { role: "CUSTOM", customRoleId: "role-auditor", scopeType: "TEAM", scopeId: "team-1" },
        ],
      }),
    ).rejects.toMatchObject({
      code: "grant_exceeds_caller_permissions",
      meta: { missingPermissions: ["traces:view", "team:manage"] },
    });
    expect(findPermissionsBeyondCaller).not.toHaveBeenCalled();
  });
});
