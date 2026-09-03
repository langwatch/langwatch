import type { AuthzAccessBinding } from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import { AuthzBindingReaderService } from "../authz-binding-reader.service";
import { StubAuthzBindingRepository } from "../../repositories/__tests__/support/authz-binding.stub";
import { StubAuthzListingRepository } from "../../repositories/__tests__/support/authz-listing.stub";

const createdAt = new Date("2026-08-20T12:00:00.000Z");

function binding(overrides: Partial<AuthzAccessBinding> = {}): AuthzAccessBinding {
  return {
    id: "binding-1",
    organizationId: "org-1",
    userId: "user-1",
    groupId: null,
    apiKeyId: null,
    role: "MEMBER",
    customRoleId: null,
    scopeType: "TEAM",
    scopeId: "team-1",
    createdAt,
    user: { id: "user-1", name: "Alice", email: "a@example.com", image: null },
    group: null,
    apiKey: null,
    customRole: null,
    ...overrides,
  };
}

function setup() {
  const bindings = new StubAuthzBindingRepository();
  const listing = new StubAuthzListingRepository();
  const reader = AuthzBindingReaderService.create({ bindings, listing });
  return { bindings, listing, reader };
}

describe("Authz binding management reads", () => {
  it("warns only when the first explicit binding replaces legacy shared-team access", async () => {
    const { bindings, reader } = setup();
    bindings.hasBindingsForUser.mockResolvedValue(false);
    bindings.hasLegacySharedTeamMembership.mockResolvedValue(true);

    await expect(
      reader.wouldFirstBindingDisableLegacyAccess({
        organizationId: "org-1",
        userId: "user-1",
      }),
    ).resolves.toBe(true);

    bindings.hasBindingsForUser.mockResolvedValue(true);
    await expect(
      reader.wouldFirstBindingDisableLegacyAccess({
        organizationId: "org-1",
        userId: "user-1",
      }),
    ).resolves.toBe(false);
  });

  it("routes through the selected listing head and hides personal scopes", async () => {
    const { bindings, listing, reader } = setup();
    listing.findUserBindings.mockResolvedValue([
      binding(),
      binding({ id: "personal", scopeId: "team-personal" }),
    ]);
    bindings.findScopeRows.mockResolvedValue([
      {
        type: "TEAM",
        id: "team-1",
        name: "Shared",
        personalWorkspaceName: null,
      },
      {
        type: "TEAM",
        id: "team-personal",
        name: "Alice's Workspace",
        personalWorkspaceName: "Alice's Workspace",
      },
    ]);

    const rows = await reader.listForUser({
      organizationId: "org-1",
      userId: "user-1",
    });

    expect(listing.findUserBindings).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(rows).toEqual([
      {
        id: "binding-1",
        userId: "user-1",
        role: "MEMBER",
        customRoleId: null,
        customRoleName: null,
        scopeType: "TEAM",
        scopeId: "team-1",
        scopeName: "Shared",
        createdAt,
      },
    ]);
  });

  it("decorates organization rows with only current organization group members", async () => {
    const { bindings, listing, reader } = setup();
    listing.findOrganizationBindings.mockResolvedValue([
      binding({
        userId: null,
        groupId: "group-1",
        user: null,
        group: { id: "group-1", name: "Security", scimSource: "scim" },
      }),
    ]);
    bindings.findScopeRows.mockResolvedValue([
      {
        type: "TEAM",
        id: "team-1",
        name: "Shared",
        personalWorkspaceName: null,
      },
    ]);
    bindings.findGroupMembers.mockResolvedValue([{ groupId: "group-1", userId: "member-1" }]);

    const rows = await reader.listForOrganization({ organizationId: "org-1" });

    expect(bindings.findGroupMembers).toHaveBeenCalledWith({
      organizationId: "org-1",
      groupIds: ["group-1"],
    });
    expect(rows[0]).toMatchObject({
      groupId: "group-1",
      groupName: "Security",
      groupScimSource: "scim",
      memberUserIds: ["member-1"],
      scopeName: "Shared",
    });
  });

  it("preserves access-breakdown permission and group shapes", async () => {
    const { bindings, listing, reader } = setup();
    const customRole = {
      id: "role-1",
      name: "Reviewer",
      description: null,
      permissions: ["traces:view", 42],
      organizationId: "org-1",
      createdAt,
      updatedAt: createdAt,
    };
    listing.findUserAndGroupBindings.mockResolvedValue([
      binding({ scopeType: "ORGANIZATION", scopeId: "org-1", role: "ADMIN" }),
      binding({
        id: "binding-group",
        userId: null,
        groupId: "group-1",
        user: null,
        group: { id: "group-1", name: "Security", scimSource: null },
        role: "CUSTOM",
        customRoleId: "role-1",
        customRole,
      }),
    ]);
    bindings.tryFindOrganizationRole.mockResolvedValue("ADMIN");
    bindings.findUserGroups.mockResolvedValue([
      {
        groupId: "group-1",
        group: {
          id: "group-1",
          name: "Security",
          slug: "security",
          scimSource: null,
        },
      },
    ]);
    bindings.findScopeRows.mockResolvedValue([
      {
        type: "ORGANIZATION",
        id: "org-1",
        name: "Acme",
        personalWorkspaceName: null,
      },
      {
        type: "TEAM",
        id: "team-1",
        name: "Shared",
        personalWorkspaceName: null,
      },
    ]);

    const result = await reader.getAccessBreakdown({
      organizationId: "org-1",
      userId: "user-1",
      userName: "Alice",
      userEmail: "a@example.com",
    });

    expect(result.user).toMatchObject({
      id: "user-1",
      orgRole: "ADMIN",
    });
    expect(result.user.orgRolePermissions).toContain("organization:manage");
    expect(result.directBindings[0]).toMatchObject({
      id: "binding-1",
      scopeName: "Acme",
    });
    expect(result.groups).toEqual([
      {
        id: "group-1",
        name: "Security",
        slug: "security",
        scimSource: null,
        bindings: [
          {
            id: "binding-group",
            role: "CUSTOM",
            customRoleName: "Reviewer",
            scopeType: "TEAM",
            scopeId: "team-1",
            scopeName: "Shared",
            permissions: ["traces:view"],
          },
        ],
      },
    ]);
  });
});
