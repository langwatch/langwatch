import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Grant,
  type Group,
  PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { resetAuthzEngineGateForTesting } from "~/server/app-layer/authz/engine-gate";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import type { RoleBindingRepository } from "~/server/app-layer/role-bindings/repositories/role-binding.repository";
import { createPrismaPgAdapter } from "~/server/prismaPgAdapter";
import type { RoleService } from "~/server/role/role.service";
import { RoleBindingService } from "../role-binding.service";

const validateScopeInOrg = vi.fn();
const validateRolesAssignable = vi.fn();
const organizationUserFindFirst = vi.fn();
const groupFindFirst = vi.fn();
const attachBindings = vi.fn();
const grantFindMany = vi.fn();
const groupMembershipFindMany = vi.fn();

function grant(overrides: Partial<Grant> = {}): Grant {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "grant_test",
    organizationId: "org_1",
    principalType: "GROUP",
    principalId: "group_1",
    roleKey: "member",
    legacyRole: "MEMBER",
    source: "migration",
    scopeType: "TEAM",
    scopeId: "team_1",
    token: null,
    permission: null,
    resourceKind: null,
    projectId: null,
    createdByUserId: null,
    expiresAt: null,
    maxViews: null,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  };
}

function group(overrides: Partial<Group> = {}): Group {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "group_1",
    organizationId: "org_1",
    name: "Engineering",
    slug: "engineering",
    externalId: null,
    scimSource: null,
    scimConnectionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const prisma = new PrismaClient({
  adapter: createPrismaPgAdapter("postgresql://localhost/unused_role_binding"),
});
vi.spyOn(prisma.organizationUser, "findFirst").mockImplementation(
  organizationUserFindFirst,
);
vi.spyOn(prisma.group, "findFirst").mockImplementation(groupFindFirst);
vi.spyOn(prisma.group, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.team, "findFirst").mockResolvedValue(null);
vi.spyOn(prisma.organization, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.team, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.project, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.grant, "findMany").mockImplementation(grantFindMany);
vi.spyOn(prisma.groupMembership, "findMany").mockImplementation(
  groupMembershipFindMany,
);
vi.spyOn(prisma.user, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.apiKey, "findMany").mockResolvedValue([]);
vi.spyOn(prisma.role, "findMany").mockResolvedValue([]);

afterAll(async () => {
  await prisma.$disconnect();
});

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
  grantFindMany.mockResolvedValue([]);
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
    grantFindMany.mockResolvedValue([
      grant({ id: "grant_foreign_group", principalId: "group_foreign" }),
    ]);

    const listed = await service.listForOrg({ organizationId: "org_1" });

    expect(listed).toEqual([]);
    expect(grantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_1" }),
      }),
    );
    expect(prisma.group.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["group_foreign"] }, organizationId: "org_1" },
      }),
    );
  });

  it("keeps an in-organization group principal in organization reads", async () => {
    grantFindMany.mockResolvedValue([grant({ id: "grant_group" })]);
    vi.mocked(prisma.group.findMany).mockResolvedValue([group()]);

    const listed = await service.listForOrg({ organizationId: "org_1" });

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      groupId: "group_1",
      groupName: "Engineering",
      role: TeamUserRole.MEMBER,
    });
  });
});
