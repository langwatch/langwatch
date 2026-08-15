/**
 * Unit tests for the role-binding write path: the exactly-one-principal
 * rule (user, group, or API key), API-key principal validation, the
 * write-time refusal of organization-exclusive permissions below
 * organization scope, and the deterministic conflict on an identical
 * binding.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Prisma,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "../role-binding.service";

const validateScopeInOrg = vi.fn();
const filterAssignableRoleIds = vi.fn();
const organizationUserFindFirst = vi.fn();
const groupFindFirst = vi.fn();
const apiKeyFindFirst = vi.fn();
const bindingCreate = vi.fn();
const bindingFindFirst = vi.fn();
const bindingUpdate = vi.fn();
const customRoleFindMany = vi.fn();
const transaction = vi.fn();

const prisma = {
  organizationUser: { findFirst: organizationUserFindFirst },
  group: { findFirst: groupFindFirst },
  apiKey: { findFirst: apiKeyFindFirst },
  // The personal-team guard runs on every binding write; a shared team here.
  team: { findFirst: vi.fn().mockResolvedValue(null) },
  project: { findFirst: vi.fn().mockResolvedValue(null) },
  roleBinding: {
    create: bindingCreate,
    findFirst: bindingFindFirst,
    update: bindingUpdate,
  },
  customRole: { findMany: customRoleFindMany },
  $transaction: transaction,
} as unknown as PrismaClient;

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
  bindingCreate.mockResolvedValue({ id: "binding_1" });
  bindingFindFirst.mockResolvedValue(null);
  bindingUpdate.mockResolvedValue({ id: "binding_1" });
  customRoleFindMany.mockResolvedValue([]);
  // A real RoleService over the same mocked client: the org-exclusive scope
  // guard lives there and reads `customRole.findMany`, so a hand-written
  // double would pin the delegation rather than the rule.
  const roleService = new RoleService(prisma);
  vi.spyOn(roleService, "filterAssignableRoleIds").mockImplementation(
    filterAssignableRoleIds as unknown as RoleService["filterAssignableRoleIds"],
  );
  service = new RoleBindingService(prisma, repository, roleService);
});

const bindingInput = {
  organizationId: "org_1",
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
      expect(bindingCreate).not.toHaveBeenCalled();
    });

    it("rejects two principals at once", async () => {
      await expect(
        service.create({
          ...bindingInput,
          userId: "user_1",
          apiKeyId: "key_1",
        }),
      ).rejects.toMatchObject({ code: "role_binding_principal_invalid" });
      expect(bindingCreate).not.toHaveBeenCalled();
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
      expect(bindingCreate).not.toHaveBeenCalled();
    });

    it("stores the binding against the key", async () => {
      await service.create({ ...bindingInput, apiKeyId: "key_1" });

      expect(bindingCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            apiKeyId: "key_1",
            userId: null,
            groupId: null,
          }),
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

      expect(bindingCreate).not.toHaveBeenCalled();
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
      });

      // No permission inspection is needed at organization scope.
      expect(customRoleFindMany).not.toHaveBeenCalled();
      expect(bindingCreate).toHaveBeenCalled();
    });
  });

  describe("when an identical binding already exists", () => {
    it("maps the unique-constraint violation to a deterministic conflict", async () => {
      bindingCreate.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        }),
      );

      await expect(
        service.create({ ...bindingInput, userId: "user_1" }),
      ).rejects.toMatchObject({ code: "role_binding_already_exists" });
    });

    it("does not swallow other database failures", async () => {
      bindingCreate.mockRejectedValue(new Error("connection reset"));

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
      }),
    ).rejects.toMatchObject({ code: "org_exclusive_permission_scope" });

    expect(bindingUpdate).not.toHaveBeenCalled();
  });
});

describe("RoleBindingService applyMemberBindings", () => {
  it("refuses an organization-exclusive permission before opening the transaction", async () => {
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
      }),
    ).rejects.toMatchObject({ code: "org_exclusive_permission_scope" });

    expect(transaction).not.toHaveBeenCalled();
  });
});
