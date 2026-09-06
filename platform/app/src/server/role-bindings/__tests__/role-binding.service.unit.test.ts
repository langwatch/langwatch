/**
 * Unit tests for the role-binding write path: the exactly-one-principal
 * rule (user, group, or API key), API-key principal validation, the
 * write-time refusal of organization-exclusive permissions below
 * organization scope, and the deterministic conflict on an identical
 * binding.
 */

import { DuplicateBindingError } from "@langwatch/authz-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "../role-binding.service";

const validateScopeInOrg = vi.fn();
const filterAssignableRoleIds = vi.fn();
const organizationUserFindFirst = vi.fn();
const organizationUserFindMany = vi.fn();
const groupFindFirst = vi.fn();
const groupUpdate = vi.fn();
const groupMembershipDeleteMany = vi.fn();
const groupMembershipCreateMany = vi.fn();
const apiKeyFindFirst = vi.fn();
const attachBindings = vi.fn();
const changeBindingRole = vi.fn();
const revokeBindings = vi.fn();
const bindingFindFirst = vi.fn();
const bindingFindMany = vi.fn();
const bindingCreate = vi.fn();
const bindingUpdate = vi.fn();
const bindingDeleteMany = vi.fn();
const customRoleFindMany = vi.fn();
const transaction = vi.fn();

const prisma = {
  organizationUser: {
    findFirst: organizationUserFindFirst,
    findMany: organizationUserFindMany,
  },
  group: { findFirst: groupFindFirst, update: groupUpdate },
  groupMembership: {
    deleteMany: groupMembershipDeleteMany,
    createMany: groupMembershipCreateMany,
  },
  apiKey: { findFirst: apiKeyFindFirst },
  // The personal-team guard runs on every binding write; a shared team here.
  team: { findFirst: vi.fn().mockResolvedValue(null) },
  project: { findFirst: vi.fn().mockResolvedValue(null) },
  roleBinding: {
    findFirst: bindingFindFirst,
    findMany: bindingFindMany,
    // The write path must never reach these three: since PR 2 the tables are
    // projection-fed and the ledger is the only writer. They are here so a
    // regression reads as a failed assertion rather than as a mock missing a
    // method.
    create: bindingCreate,
    update: bindingUpdate,
    deleteMany: bindingDeleteMany,
  },
  customRole: { findMany: customRoleFindMany },
  $transaction: transaction,
} as unknown as PrismaClient;

/**
 * Since delivery-plan PR 2 the service writes no tables: every binding
 * mutation is a grants-ledger command, so the writer is the seam these tests
 * observe and the rules under test are unchanged.
 */
const writer = {
  attachBindings,
  changeBindingRole,
  revokeBindings,
} as unknown as GrantsLedgerWriter;

const repository = {
  validateScopeInOrg,
} as unknown as RoleBindingRepository;

let service: RoleBindingService;

beforeEach(() => {
  vi.clearAllMocks();
  validateScopeInOrg.mockResolvedValue(undefined);
  filterAssignableRoleIds.mockResolvedValue([]);
  // The membership row rather than a count: the write path reads the seat
  // off it to ceiling a Lite Member's bindings.
  organizationUserFindFirst.mockResolvedValue({ role: "MEMBER" });
  groupFindFirst.mockResolvedValue({ id: "group_1" });
  apiKeyFindFirst.mockResolvedValue({ id: "key_1" });
  attachBindings.mockResolvedValue({ attached: ["binding_1"], duplicates: [] });
  changeBindingRole.mockResolvedValue(undefined);
  revokeBindings.mockResolvedValue(undefined);
  bindingFindFirst.mockResolvedValue(null);
  bindingFindMany.mockResolvedValue([]);
  customRoleFindMany.mockResolvedValue([]);
  organizationUserFindMany.mockResolvedValue([]);
  groupUpdate.mockResolvedValue(undefined);
  groupMembershipDeleteMany.mockResolvedValue(undefined);
  groupMembershipCreateMany.mockResolvedValue(undefined);
  transaction.mockImplementation(async (cb: (tx: PrismaClient) => unknown) =>
    cb(prisma),
  );
  // A real RoleService over the same mocked client: the org-exclusive scope
  // guard lives there and reads `customRole.findMany`, so a hand-written
  // double would pin the delegation rather than the rule.
  const roleService = new RoleService(prisma);
  vi.spyOn(roleService, "filterAssignableRoleIds").mockImplementation(
    filterAssignableRoleIds as unknown as RoleService["filterAssignableRoleIds"],
  );
  service = new RoleBindingService({
    prisma,
    repo: repository,
    roleService,
    writer,
  });
});

const actor = { type: "user" as const, id: "user_admin" };

const bindingInput = {
  organizationId: "org_1",
  actor,
  role: TeamUserRole.MEMBER,
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: "team_1",
};

describe("RoleBindingService create", () => {
  describe("when the request names no principal or several", () => {
    it("rejects an empty principal set", async () => {
      await expect(service.create({ ...bindingInput })).rejects.toMatchObject({
        code: "role_binding_principal_invalid",
      });
      expect(attachBindings).not.toHaveBeenCalled();
    });

    it("rejects two principals at once", async () => {
      await expect(
        service.create({
          ...bindingInput,
          userId: "user_1",
          apiKeyId: "key_1",
        }),
      ).rejects.toMatchObject({ code: "role_binding_principal_invalid" });
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the principal is an API key", () => {
    it("rejects a key from another organization as a rejected value, not a missing resource", async () => {
      apiKeyFindFirst.mockResolvedValue(null);

      await expect(
        service.create({ ...bindingInput, apiKeyId: "foreign_key" }),
      ).rejects.toMatchObject({
        code: "api_key_not_in_organization",
        httpStatus: 422,
      });

      expect(apiKeyFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "foreign_key", organizationId: "org_1" },
        }),
      );
      expect(attachBindings).not.toHaveBeenCalled();
    });

    /** @scenario "Every write goes through the group queue" */
    it("stores the binding against the key", async () => {
      await service.create({ ...bindingInput, apiKeyId: "key_1" });

      expect(bindingCreate).not.toHaveBeenCalled();
      expect(bindingUpdate).not.toHaveBeenCalled();
      expect(bindingDeleteMany).not.toHaveBeenCalled();

      expect(attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          bindings: [
            expect.objectContaining({ principal: { apiKeyId: "key_1" } }),
          ],
          onDuplicate: "reject",
        }),
      );
    });
  });

  describe("when the role is CUSTOM", () => {
    it("requires a customRoleId", async () => {
      await expect(
        service.create({
          ...bindingInput,
          userId: "user_1",
          role: TeamUserRole.CUSTOM,
        }),
      ).rejects.toMatchObject({ code: "custom_role_id_required" });
    });

    it("rejects a custom role that is not assignable in the organization", async () => {
      filterAssignableRoleIds.mockResolvedValue([]);

      await expect(
        service.create({
          ...bindingInput,
          userId: "user_1",
          role: TeamUserRole.CUSTOM,
          customRoleId: "cr_foreign",
        }),
      ).rejects.toMatchObject({ code: "custom_role_not_assignable" });
    });

    it("refuses an organization-exclusive permission at team scope", async () => {
      filterAssignableRoleIds.mockResolvedValue(["cr_1"]);
      customRoleFindMany.mockResolvedValue([
        { id: "cr_1", permissions: ["organization:manage", "traces:view"] },
      ]);

      await expect(
        service.create({
          ...bindingInput,
          userId: "user_1",
          role: TeamUserRole.CUSTOM,
          customRoleId: "cr_1",
        }),
      ).rejects.toMatchObject({
        code: "org_exclusive_permission_scope",
        meta: expect.objectContaining({ permission: "organization:manage" }),
      });

      expect(attachBindings).not.toHaveBeenCalled();
    });

    it("allows the same custom role at organization scope", async () => {
      filterAssignableRoleIds.mockResolvedValue(["cr_1"]);

      await service.create({
        organizationId: "org_1",
        userId: "user_1",
        role: TeamUserRole.CUSTOM,
        customRoleId: "cr_1",
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: "org_1",
        actor,
      });

      // No permission inspection is needed at organization scope.
      expect(customRoleFindMany).not.toHaveBeenCalled();
      expect(attachBindings).toHaveBeenCalled();
    });
  });

  describe("when an identical binding already exists", () => {
    it("maps the ledger's duplicate signal to a deterministic conflict", async () => {
      attachBindings.mockRejectedValue(new DuplicateBindingError());

      await expect(
        service.create({ ...bindingInput, userId: "user_1" }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });

    it("does not swallow other write failures", async () => {
      attachBindings.mockRejectedValue(new Error("connection reset"));

      await expect(
        service.create({ ...bindingInput, userId: "user_1" }),
      ).rejects.toThrow("connection reset");
    });
  });
});

describe("RoleBindingService update", () => {
  it("answers not found for a binding outside the organization", async () => {
    bindingFindFirst.mockResolvedValue(null);

    await expect(
      service.update({
        organizationId: "org_1",
        bindingId: "binding_ghost",
        role: TeamUserRole.MEMBER,
        actor,
      }),
    ).rejects.toMatchObject({ code: "role_binding_not_found" });
  });

  it("refuses an organization-exclusive permission on a team-scoped binding", async () => {
    bindingFindFirst.mockResolvedValue({
      id: "binding_1",
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: "team_1",
    });
    filterAssignableRoleIds.mockResolvedValue(["cr_1"]);
    customRoleFindMany.mockResolvedValue([
      { id: "cr_1", permissions: ["governance:manage"] },
    ]);

    await expect(
      service.update({
        organizationId: "org_1",
        bindingId: "binding_1",
        role: TeamUserRole.CUSTOM,
        customRoleId: "cr_1",
        actor,
      }),
    ).rejects.toMatchObject({ code: "org_exclusive_permission_scope" });

    expect(changeBindingRole).not.toHaveBeenCalled();
  });
});

describe("RoleBindingService applyMemberBindings", () => {
  it("refuses an organization-exclusive permission before emitting anything", async () => {
    filterAssignableRoleIds.mockResolvedValue(["cr_1"]);
    customRoleFindMany.mockResolvedValue([
      { id: "cr_1", permissions: ["organization:manage"] },
    ]);

    await expect(
      service.applyMemberBindings({
        organizationId: "org_1",
        userId: "user_1",
        bindingIdsToDelete: [],
        bindingsToCreate: [
          {
            role: TeamUserRole.CUSTOM,
            customRoleId: "cr_1",
            scopeType: RoleBindingScopeType.PROJECT,
            scopeId: "proj_1",
          },
        ],
        actor,
      }),
    ).rejects.toMatchObject({ code: "org_exclusive_permission_scope" });

    expect(attachBindings).not.toHaveBeenCalled();
    expect(revokeBindings).not.toHaveBeenCalled();
  });
});

describe("RoleBindingService applyGroupEdits", () => {
  const groupEditInput = {
    organizationId: "org_1",
    groupId: "group_1",
    rename: null,
    bindingsToCreate: [],
    memberUserIdsToAdd: [],
    memberUserIdsToRemove: ["user_removed"],
    actor,
  };

  describe("when the edit both revokes a group binding and removes a member", () => {
    /** @scenario "Revoking an orphaned group binding runs before the membership edit commits" */
    it("revokes the group's bindings before applying the membership edit", async () => {
      bindingFindMany.mockResolvedValue([
        {
          id: "binding_1",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_1",
        },
      ]);

      await service.applyGroupEdits({
        ...groupEditInput,
        bindingIdsToDelete: ["binding_1"],
      });

      expect(revokeBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          bindingIds: ["binding_1"],
          actor,
        }),
      );
      expect(groupMembershipDeleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { groupId: "group_1", userId: { in: ["user_removed"] } },
        }),
      );
      // The mock call orders are process-wide monotonic counters, so a lower
      // number on the revoke than on the membership delete is proof the
      // ledger command really ran first, not just that both ran.
      expect(revokeBindings.mock.invocationCallOrder[0]!).toBeLessThan(
        groupMembershipDeleteMany.mock.invocationCallOrder[0]!,
      );
    });

    it("never opens the membership transaction when the revoke fails", async () => {
      bindingFindMany.mockResolvedValue([
        {
          id: "binding_1",
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: "team_1",
        },
      ]);
      revokeBindings.mockRejectedValue(new Error("ledger unavailable"));

      await expect(
        service.applyGroupEdits({
          ...groupEditInput,
          bindingIdsToDelete: ["binding_1"],
        }),
      ).rejects.toThrow("ledger unavailable");

      // A crash between the two commands must leave less access, never more:
      // the member removal (and any rename) must not have committed.
      expect(transaction).not.toHaveBeenCalled();
      expect(groupMembershipDeleteMany).not.toHaveBeenCalled();
    });
  });

  describe("when no requested delete resolves to a live binding", () => {
    it("skips the revoke call but still applies the membership edit", async () => {
      bindingFindMany.mockResolvedValue([]);

      await service.applyGroupEdits({
        ...groupEditInput,
        bindingIdsToDelete: ["binding_ghost"],
      });

      expect(revokeBindings).not.toHaveBeenCalled();
      expect(groupMembershipDeleteMany).toHaveBeenCalled();
    });
  });

  /**
   * A group the directory owns is edited by the directory or not at all,
   * whichever way its access is stored underneath. These three used to throw
   * a raw TRPCError whose `code` published as "BAD_REQUEST" and whose message
   * was the whole contract, so the `scim_managed_group` anchor in
   * specs/groups/groups-rest-api.feature held on `group.service.ts`'s path
   * only. Both paths answer the customer the same code now.
   */
  describe("when the group is managed by an identity provider", () => {
    beforeEach(() => {
      groupFindFirst.mockResolvedValue({ id: "group_1", scimSource: "okta" });
    });

    it("refuses a rename with scim_managed_group", async () => {
      await expect(
        service.applyGroupEdits({
          ...groupEditInput,
          memberUserIdsToRemove: [],
          bindingIdsToDelete: [],
          rename: { name: "New Name", slug: "new-name" },
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group", httpStatus: 409 });

      expect(groupUpdate).not.toHaveBeenCalled();
    });

    it("refuses a member removal with scim_managed_group", async () => {
      await expect(
        service.applyGroupEdits({
          ...groupEditInput,
          bindingIdsToDelete: [],
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group", httpStatus: 409 });

      expect(groupMembershipDeleteMany).not.toHaveBeenCalled();
    });

    it("refuses a member addition with scim_managed_group", async () => {
      await expect(
        service.applyGroupEdits({
          ...groupEditInput,
          memberUserIdsToRemove: [],
          memberUserIdsToAdd: ["user_added"],
          bindingIdsToDelete: [],
        }),
      ).rejects.toMatchObject({ code: "scim_managed_group", httpStatus: 409 });

      expect(groupMembershipCreateMany).not.toHaveBeenCalled();
    });
  });
});
