/**
 * The writer's guards every door reaches (`/api/role-bindings`, `/api/grants`,
 * tRPC): escalation, the organization's grant limit, and the last administrator.
 * @see specs/rbac/grants-rest-api.feature
 */
import {
  type AuthzManagedOrganizationBinding,
  type AuthzPrincipalRef,
} from "@langwatch/authz-contract";
import { describe, expect, it, vi } from "vitest";

import type { AuthzCompatibilityLedger } from "../../app/authz.app.ts";
import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import { GRANT_LIMIT_PER_ORGANIZATION } from "../../rules/grant-escalation.rules.ts";
import {
  AuthzGrantWriterService,
  type AuthzGrantWriterPermissions,
} from "../authz-grant-writer.service.ts";

const ORG = "org-1";
const actor = { type: "user" as const, id: "caller-1" };
const self: AuthzPrincipalRef = { type: "user", id: "caller-1" };
const key: AuthzPrincipalRef = { type: "apiKey", id: "key-1" };

const row = (
  over: Partial<AuthzManagedOrganizationBinding> & Pick<AuthzManagedOrganizationBinding, "id">,
): AuthzManagedOrganizationBinding => ({
  userId: null,
  userName: null,
  userEmail: null,
  userImage: null,
  groupId: null,
  groupName: null,
  groupScimSource: null,
  apiKeyId: null,
  apiKeyName: null,
  role: "MEMBER",
  customRoleId: null,
  customRoleName: null,
  scopeType: "TEAM",
  scopeId: "team-1",
  scopeName: "Team",
  memberUserIds: [],
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  expiresAt: null,
  ...over,
});

type ExistingBinding = Readonly<{
  id: string;
  scopeType: "TEAM" | "ORGANIZATION";
  role: AuthzManagedOrganizationBinding["role"];
}>;

function setup({
  lacks = [],
  rows = [],
  existing = { id: "rb-1", scopeType: "TEAM", role: "MEMBER" },
}: {
  lacks?: string[];
  rows?: AuthzManagedOrganizationBinding[];
  existing?: ExistingBinding;
} = {}) {
  const bindings = new StubAuthzManagedGrantRepository();
  bindings.findScopeRows.mockResolvedValue([
    { type: "TEAM", id: "team-1", name: "Team", personalWorkspaceName: null },
    { type: "ORGANIZATION", id: ORG, name: "Org", personalWorkspaceName: null },
  ]);
  bindings.findOrganizationRole.mockResolvedValue("MEMBER");
  bindings.isGroupInOrganization.mockResolvedValue(true);
  bindings.isApiKeyInOrganization.mockResolvedValue(true);
  bindings.findAssignableRoles.mockResolvedValue([
    { id: "customrole_vault", permissions: ["secrets:manage"] },
  ]);
  bindings.findBinding.mockResolvedValue({
    id: existing.id,
    organizationId: ORG,
    userId: "caller-1",
    groupId: null,
    apiKeyId: null,
    role: existing.role,
    customRoleId: null,
    scopeType: existing.scopeType,
    scopeId: existing.scopeType === "TEAM" ? "team-1" : ORG,
  });
  const attachBindings = vi
    .fn<AuthzCompatibilityLedger["attachBindings"]>()
    .mockResolvedValue({ attached: [], duplicates: [] });
  const changeBindingRole = vi
    .fn<AuthzCompatibilityLedger["changeBindingRole"]>()
    .mockResolvedValue(void 0);
  const revokeBindings = vi
    .fn<AuthzCompatibilityLedger["revokeBindings"]>()
    .mockResolvedValue(void 0);
  const findPermissionsBeyondCaller = vi.fn<
    AuthzGrantWriterPermissions["findPermissionsBeyondCaller"]
  >(async (input) => input.permissions.filter((permission) => lacks.includes(permission)));
  const writer = AuthzGrantWriterService.create({
    bindings,
    ledger: {
      attachBindings,
      attachResourceGrant: vi.fn<AuthzCompatibilityLedger["attachResourceGrant"]>(),
      revokeResourceGrants: vi.fn<AuthzCompatibilityLedger["revokeResourceGrants"]>(),
      changeBindingRole,
      revokeBindings,
      revokeBindingsWhere: vi.fn<AuthzCompatibilityLedger["revokeBindingsWhere"]>(),
      offboardMember: vi.fn<AuthzCompatibilityLedger["offboardMember"]>(),
      defineRole: vi.fn<AuthzCompatibilityLedger["defineRole"]>(),
      deleteRole: vi.fn<AuthzCompatibilityLedger["deleteRole"]>(),
    },
    newBindingId: () => "rb-new",
    permissions: {
      findPermissionsBeyondCaller,
      listManagedBindingsForOrganization: async () => rows,
    },
  });

  return { writer, attachBindings, changeBindingRole, revokeBindings, findPermissionsBeyondCaller };
}

describe("given the binding writer every door writes through", () => {
  describe("when the role carries permissions the caller lacks", () => {
    /** @scenario Granting beyond the caller's own permissions is refused */
    it.each([
      { principal: "myself", fields: { userId: "caller-1" } },
      { principal: "a group I belong to", fields: { groupId: "group-mine" } },
      { principal: "an API key", fields: { apiKeyId: "key-2" } },
      { principal: "another member", fields: { userId: "user-2" } },
    ])("refuses a grant to $principal and writes nothing", async ({ fields }) => {
      const { writer, attachBindings } = setup({ lacks: ["secrets:manage"] });

      await expect(
        writer.create({
          organizationId: ORG,
          ...fields,
          role: "CUSTOM",
          customRoleId: "customrole_vault",
          scopeType: "TEAM",
          scopeId: "team-1",
          actor,
          caller: self,
        }),
      ).rejects.toMatchObject({
        code: "grant_exceeds_caller_permissions",
        httpStatus: 403,
        meta: { missingPermissions: ["secrets:manage"] },
      });
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the caller holds every permission of the role", () => {
    /** @scenario Granting a role at the caller's own level is allowed */
    it("writes the binding and asks about the caller at the binding's scope", async () => {
      const { writer, attachBindings, findPermissionsBeyondCaller } = setup();

      await writer.create({
        organizationId: ORG,
        userId: "user-2",
        role: "MEMBER",
        scopeType: "TEAM",
        scopeId: "team-1",
        actor,
        caller: key,
      });

      expect(attachBindings).toHaveBeenCalledOnce();
      expect(findPermissionsBeyondCaller).toHaveBeenCalledWith(
        expect.objectContaining({ caller: key, scope: { type: "team", id: "team-1" } }),
      );
    });
  });

  describe("when a caller changes their own binding to a wider role", () => {
    /** @scenario The role bindings door and the grants door refuse escalation alike */
    it("refuses the change through the same check and leaves the binding", async () => {
      const { writer, changeBindingRole } = setup({ lacks: ["project:delete"] });

      await expect(
        writer.update({
          organizationId: ORG,
          bindingId: "rb-1",
          role: "ADMIN",
          actor,
          caller: self,
        }),
      ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
      expect(changeBindingRole).not.toHaveBeenCalled();
    });

    it("refuses a member-dialog batch the same way", async () => {
      const { writer, attachBindings } = setup({ lacks: ["project:delete"] });

      await expect(
        writer.applyMemberBindings({
          organizationId: ORG,
          userId: "caller-1",
          bindingIdsToDelete: [],
          bindingsToCreate: [{ role: "ADMIN", scopeType: "TEAM", scopeId: "team-1" }],
          actor,
          caller: self,
        }),
      ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the organization already holds as many grants as the limit allows", () => {
    /** @scenario A grant beyond the organization's limit is refused */
    it("refuses with grant_limit_reached, reporting the limit, and writes nothing", async () => {
      const rows = Array.from({ length: GRANT_LIMIT_PER_ORGANIZATION }, (_, index) =>
        row({ id: `rb-${index}` }),
      );
      const { writer, attachBindings } = setup({ rows });

      await expect(
        writer.create({
          organizationId: ORG,
          userId: "user-2",
          role: "VIEWER",
          scopeType: "TEAM",
          scopeId: "team-1",
          actor,
          caller: self,
        }),
      ).rejects.toMatchObject({
        code: "grant_limit_reached",
        httpStatus: 409,
        meta: { limit: GRANT_LIMIT_PER_ORGANIZATION },
      });
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the binding is the organization's last administrator", () => {
    const lastAdmin = [
      row({ id: "rb-1", userId: "caller-1", role: "ADMIN", scopeType: "ORGANIZATION" }),
      row({
        id: "rb-2",
        userId: "user-2",
        role: "ADMIN",
        scopeType: "ORGANIZATION",
        expiresAt: new Date(1),
      }),
    ];
    const existing = { id: "rb-1", scopeType: "ORGANIZATION" as const, role: "ADMIN" as const };

    /** @scenario The last administrator grant of an organization cannot be revoked */
    it("refuses the revoke with cannot_remove_last_admin", async () => {
      const { writer, revokeBindings } = setup({ rows: lastAdmin, existing });

      await expect(
        writer.delete({ organizationId: ORG, bindingId: "rb-1", actor }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });
      expect(revokeBindings).not.toHaveBeenCalled();
    });

    /** @scenario The last administrator grant of an organization cannot be lowered */
    it("refuses the demotion with cannot_demote_last_admin", async () => {
      const { writer, changeBindingRole } = setup({ rows: lastAdmin, existing });

      await expect(
        writer.update({
          organizationId: ORG,
          bindingId: "rb-1",
          role: "MEMBER",
          actor,
          caller: self,
        }),
      ).rejects.toMatchObject({ code: "cannot_demote_last_admin" });
      expect(changeBindingRole).not.toHaveBeenCalled();
    });

    it("revokes one administrator when another live one remains", async () => {
      const rows = [
        ...lastAdmin,
        row({ id: "rb-3", userId: "user-3", role: "ADMIN", scopeType: "ORGANIZATION" }),
      ];
      const { writer, revokeBindings } = setup({ rows, existing });

      await writer.delete({ organizationId: ORG, bindingId: "rb-1", actor });

      expect(revokeBindings).toHaveBeenCalledOnce();
    });
  });
});

describe("given a caller changing a binding that already exists", () => {
  describe("when the binding's current role confers what the caller lacks", () => {
    /** @scenario Changing a binding above the caller's own standing is refused */
    it("refuses to demote it and leaves the binding", async () => {
      const { writer, changeBindingRole } = setup({
        lacks: ["project:delete"],
        existing: { id: "rb-1", scopeType: "TEAM", role: "ADMIN" },
      });

      await expect(
        writer.update({
          organizationId: ORG,
          bindingId: "rb-1",
          role: "VIEWER",
          actor,
          caller: self,
        }),
      ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
      expect(changeBindingRole).not.toHaveBeenCalled();
    });

    it("refuses the grants door's role change the same way", async () => {
      const { writer } = setup({
        lacks: ["project:delete"],
        existing: { id: "rb-1", scopeType: "TEAM", role: "ADMIN" },
      });

      await expect(
        writer.assertRoleChangeWithinCaller({
          organizationId: ORG,
          caller: self,
          bindingId: "rb-1",
          role: "VIEWER",
          customRoleId: null,
        }),
      ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
    });
  });

  describe("when the caller holds everything the current role confers", () => {
    /** @scenario Demoting a binding within the caller's own standing is allowed */
    it("demotes it", async () => {
      const { writer, changeBindingRole } = setup({
        lacks: ["project:delete"],
        existing: { id: "rb-1", scopeType: "TEAM", role: "MEMBER" },
      });

      await writer.update({
        organizationId: ORG,
        bindingId: "rb-1",
        role: "VIEWER",
        actor,
        caller: self,
      });

      expect(changeBindingRole).toHaveBeenCalledOnce();
    });

    it("lets the grants door's role change through", async () => {
      const { writer } = setup({
        lacks: ["project:delete"],
        existing: { id: "rb-1", scopeType: "TEAM", role: "MEMBER" },
      });

      await expect(
        writer.assertRoleChangeWithinCaller({
          organizationId: ORG,
          caller: self,
          bindingId: "rb-1",
          role: "VIEWER",
          customRoleId: null,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
