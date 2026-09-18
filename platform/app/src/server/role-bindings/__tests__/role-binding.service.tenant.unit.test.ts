import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/engine-gate";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import type { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "../role-binding.service";

const validateScopeInOrg = vi.fn();
const validateRolesAssignable = vi.fn();
const organizationUserFindFirst = vi.fn();
const groupFindFirst = vi.fn();
const attachBindings = vi.fn();
const bindingFindMany = vi.fn();
const groupMembershipFindMany = vi.fn();

const prisma = {
  organizationUser: { findFirst: organizationUserFindFirst },
  group: { findFirst: groupFindFirst },
  // The personal-team guard runs on every binding write; a shared team here.
  team: { findFirst: vi.fn().mockResolvedValue(null) },
  roleBinding: {
    findMany: bindingFindMany,
  },
  groupMembership: { findMany: groupMembershipFindMany },
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
} as unknown as GrantsLedgerWriter;

const repository = {
  validateScopeInOrg,
} as unknown as RoleBindingRepository;

const roleService = {
  validateRolesAssignable,
} as unknown as RoleService;

let service: RoleBindingService;

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthzEngineGateForTesting();
  validateScopeInOrg.mockResolvedValue(undefined);
  validateRolesAssignable.mockResolvedValue(undefined);
  organizationUserFindFirst.mockResolvedValue({ role: "MEMBER" });
  groupFindFirst.mockResolvedValue({ id: "group_1" });
  attachBindings.mockResolvedValue({ attached: [], duplicates: [] });
  bindingFindMany.mockResolvedValue([]);
  groupMembershipFindMany.mockResolvedValue([]);
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
              // And still a live group: a deleted one is kept as a row so its
              // memberships survive it, so a listing without the fence would
              // report access nobody holds.
              group: { organizationId: "org_1", deletedAt: null },
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
