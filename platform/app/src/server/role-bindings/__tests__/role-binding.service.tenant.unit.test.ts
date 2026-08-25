import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import type { RoleService } from "@langwatch/role-contract";
import { RoleBindingService } from "../role-binding.service";

const validateScopeInOrg = vi.fn();
const validateRolesAssignable = vi.fn();
const organizationUserFindFirst = vi.fn();
const groupFindFirst = vi.fn();
const attachBindings = vi.fn();
const listOrganizationBindings = vi.fn();

const prisma = {
  organizationUser: { findFirst: organizationUserFindFirst },
  group: { findFirst: groupFindFirst },
  // The personal-team guard runs on every binding write; a shared team here.
  team: { findFirst: vi.fn().mockResolvedValue(null) },
  roleBinding: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  // The listing reads go through the per-organization fork, which asks the
  // gate first. Answering it keeps these tests on the legacy head by choice;
  // without it the gate's read throws and they pass on the fail-safe.
  systemMigrationTenantState: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  $transaction: vi.fn(),
} as unknown as PrismaClient;

/** Every binding write is a ledger command now, so the writer is the seam. */
const writer = {
  attachBindings,
  revokeBindings: vi.fn(),
} as unknown as AuthzGrantsService;

const repository = {
  validateScopeInOrg,
} as unknown as RoleBindingRepository;

const roleService = {
  validateRolesAssignable,
} as unknown as RoleService;

const accessListing = {
  listOrganizationBindings,
} as unknown as AuthzService;

let service: RoleBindingService;

beforeEach(() => {
  vi.clearAllMocks();
  validateScopeInOrg.mockResolvedValue(undefined);
  validateRolesAssignable.mockResolvedValue(undefined);
  organizationUserFindFirst.mockResolvedValue({ role: "MEMBER" });
  groupFindFirst.mockResolvedValue({ id: "group_1" });
  attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
  listOrganizationBindings.mockResolvedValue([]);
  service = new RoleBindingService({
    prisma,
    repo: repository,
    roleService,
    writer,
    accessListing,
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

describe("RoleBindingService tenant references", () => {
  it("rejects a user principal from another organization", async () => {
    organizationUserFindFirst.mockResolvedValue(null);

    await expect(
      service.create({ ...bindingInput, userId: "foreign_user" }),
    ).rejects.toMatchObject({ code: "user_not_in_organization" });

    expect(attachBindings).not.toHaveBeenCalled();
  });

  it("rejects a group principal from another organization", async () => {
    groupFindFirst.mockResolvedValue(null);

    await expect(
      service.create({ ...bindingInput, groupId: "foreign_group" }),
    ).rejects.toMatchObject({ code: "group_not_in_organization" });

    expect(attachBindings).not.toHaveBeenCalled();
  });

  it("rejects batch bindings for a user from another organization", async () => {
    organizationUserFindFirst.mockResolvedValue(null);

    await expect(
      service.applyMemberBindings({
        organizationId: "org_1",
        userId: "foreign_user",
        bindingIdsToDelete: [],
        bindingsToCreate: [],
        actor,
      }),
    ).rejects.toMatchObject({ code: "user_not_in_organization" });
  });

  it("routes organization reads through the AuthZ capability", async () => {
    await service.listForOrg({ organizationId: "org_1" });

    expect(listOrganizationBindings).toHaveBeenCalledWith({
      organizationId: "org_1",
    });
  });
});
