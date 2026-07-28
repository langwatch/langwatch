import {
  RoleBindingScopeType,
  TeamUserRole,
  type PrismaClient,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import type { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "../role-binding.service";

const validateScopeInOrg = vi.fn();
const validateRolesAssignable = vi.fn();
const organizationUserCount = vi.fn();
const groupFindFirst = vi.fn();
const bindingCreate = vi.fn();
const bindingFindMany = vi.fn();
const groupMembershipFindMany = vi.fn();

const prisma = {
  organizationUser: { count: organizationUserCount },
  group: { findFirst: groupFindFirst },
  roleBinding: {
    create: bindingCreate,
    findMany: bindingFindMany,
  },
  groupMembership: { findMany: groupMembershipFindMany },
  $transaction: vi.fn(),
} as unknown as PrismaClient;

const repository = {
  validateScopeInOrg,
} as unknown as RoleBindingRepository;

const roleService = {
  validateRolesAssignable,
} as unknown as RoleService;

let service: RoleBindingService;

beforeEach(() => {
  vi.clearAllMocks();
  validateScopeInOrg.mockResolvedValue(undefined);
  validateRolesAssignable.mockResolvedValue(undefined);
  organizationUserCount.mockResolvedValue(1);
  groupFindFirst.mockResolvedValue({ id: "group_1" });
  bindingCreate.mockResolvedValue({ id: "binding_1" });
  bindingFindMany.mockResolvedValue([]);
  groupMembershipFindMany.mockResolvedValue([]);
  service = new RoleBindingService(prisma, repository, roleService);
});

const bindingInput = {
  organizationId: "org_1",
  role: TeamUserRole.MEMBER,
  scopeType: RoleBindingScopeType.TEAM,
  scopeId: "team_1",
};

describe("RoleBindingService tenant references", () => {
  it("rejects a user principal from another organization", async () => {
    organizationUserCount.mockResolvedValue(0);

    await expect(
      service.create({ ...bindingInput, userId: "foreign_user" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(bindingCreate).not.toHaveBeenCalled();
  });

  it("rejects a group principal from another organization", async () => {
    groupFindFirst.mockResolvedValue(null);

    await expect(
      service.create({ ...bindingInput, groupId: "foreign_group" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(bindingCreate).not.toHaveBeenCalled();
  });

  it("rejects batch bindings for a user from another organization", async () => {
    organizationUserCount.mockResolvedValue(0);

    await expect(
      service.applyMemberBindings({
        organizationId: "org_1",
        userId: "foreign_user",
        bindingIdsToDelete: [],
        bindingsToCreate: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("filters stale foreign principals from organization reads", async () => {
    await service.listForOrg({ organizationId: "org_1" });

    expect(bindingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: "org_1",
          OR: [
            {
              userId: { not: null },
              user: {
                orgMemberships: { some: { organizationId: "org_1" } },
              },
            },
            {
              groupId: { not: null },
              group: { organizationId: "org_1" },
            },
            {
              apiKeyId: { not: null },
              apiKey: { organizationId: "org_1" },
            },
          ],
        },
      }),
    );
  });
});
