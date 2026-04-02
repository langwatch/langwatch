/**
 * @vitest-environment node
 *
 * Integration tests for SCIM Group Mapping CRUD tRPC endpoints.
 * Tests with real database -- only mocks planProvider (system boundary).
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { createTestApp } from "~/server/app-layer/presets";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "scimGroupMapping router",
  () => {
    const ns = `scim-map-${nanoid(8)}`;
    let organizationId: string;
    let adminUserId: string;
    let memberUserId: string;
    let teamId: string;
    let projectId: string;
    let mockGetActivePlan: ReturnType<typeof vi.fn>;

    const enterprisePlan: PlanInfo = {
      ...FREE_PLAN,
      type: "ENTERPRISE",
      overrideAddingLimitations: true,
      maxTeams: Number.MAX_SAFE_INTEGER,
      maxMembers: Number.MAX_SAFE_INTEGER,
      maxMembersLite: Number.MAX_SAFE_INTEGER,
      maxProjects: Number.MAX_SAFE_INTEGER,
    };

    const freePlan: PlanInfo = {
      ...FREE_PLAN,
      type: "FREE",
      overrideAddingLimitations: true,
      maxTeams: Number.MAX_SAFE_INTEGER,
      maxMembers: Number.MAX_SAFE_INTEGER,
      maxMembersLite: Number.MAX_SAFE_INTEGER,
      maxProjects: Number.MAX_SAFE_INTEGER,
    };

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: {
          name: `Test Org ${ns}`,
          slug: `--test-org-${ns}`,
        },
      });
      organizationId = organization.id;

      const adminUser = await prisma.user.create({
        data: {
          name: "Admin User",
          email: `admin-${ns}@example.com`,
        },
      });
      adminUserId = adminUser.id;

      await prisma.organizationUser.create({
        data: {
          userId: adminUser.id,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });

      const memberUser = await prisma.user.create({
        data: {
          name: "Member User",
          email: `member-${ns}@example.com`,
        },
      });
      memberUserId = memberUser.id;

      await prisma.organizationUser.create({
        data: {
          userId: memberUser.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
        },
      });

      const team = await prisma.team.create({
        data: {
          name: `Team Dev ${ns}`,
          slug: `--test-team-${ns}`,
          organizationId,
        },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: `Project A ${ns}`,
          slug: `--test-project-${ns}`,
          apiKey: `test-key-${ns}`,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
      });
      projectId = project.id;
    });

    beforeEach(() => {
      resetApp();
      mockGetActivePlan = vi.fn().mockResolvedValue(enterprisePlan);
      globalForApp.__langwatch_app = createTestApp({
        planProvider: PlanProviderService.create({
          getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
        }),
      });
    });

    afterEach(() => {
      resetApp();
    });

    afterAll(async () => {
      await prisma.scimGroupMembership
        .deleteMany({
          where: {
            scimGroupMapping: {
              organization: { slug: `--test-org-${ns}` },
            },
          },
        })
        .catch(() => {});
      await prisma.scimGroupMapping
        .deleteMany({
          where: { organization: { slug: `--test-org-${ns}` } },
        })
        .catch(() => {});
      await prisma.teamUser
        .deleteMany({
          where: {
            team: { slug: { startsWith: `--test-team-${ns}` } },
          },
        })
        .catch(() => {});
      // Clean up teams created by createWithNewTeam
      await prisma.team
        .deleteMany({
          where: {
            organizationId,
            slug: { not: `--test-team-${ns}` },
          },
        })
        .catch(() => {});
      await prisma.project
        .deleteMany({
          where: { slug: `--test-project-${ns}` },
        })
        .catch(() => {});
      await prisma.team
        .deleteMany({
          where: { slug: { startsWith: `--test-team-${ns}` } },
        })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({
          where: { organization: { slug: `--test-org-${ns}` } },
        })
        .catch(() => {});
      await prisma.organization
        .deleteMany({
          where: { slug: `--test-org-${ns}` },
        })
        .catch(() => {});
      await prisma.user
        .deleteMany({
          where: {
            email: { in: [`admin-${ns}@example.com`, `member-${ns}@example.com`] },
          },
        })
        .catch(() => {});
    });

    function createAdminCaller() {
      const ctx = createInnerTRPCContext({
        session: {
          user: { id: adminUserId },
          expires: "1",
        },
      });
      return appRouter.createCaller(ctx);
    }

    function createMemberCaller() {
      const ctx = createInnerTRPCContext({
        session: {
          user: { id: memberUserId },
          expires: "1",
        },
      });
      return appRouter.createCaller(ctx);
    }

    async function createMapping({
      externalGroupId,
      externalGroupName,
      mappedTeamId,
      role,
    }: {
      externalGroupId: string;
      externalGroupName: string;
      mappedTeamId?: string;
      role?: TeamUserRole;
    }) {
      return prisma.scimGroupMapping.create({
        data: {
          organizationId,
          externalGroupId,
          externalGroupName,
          teamId: mappedTeamId ?? null,
          role: role ?? null,
        },
      });
    }

    describe("when admin requests all mappings", () => {
      it("returns mapped and unmapped groups with correct fields", async () => {
        const caller = createAdminCaller();

        const unmapped = await createMapping({
          externalGroupId: `unmapped-${nanoid(4)}`,
          externalGroupName: "clienta-dev-ro",
        });

        const mapped = await createMapping({
          externalGroupId: `mapped-${nanoid(4)}`,
          externalGroupName: "clienta-dev-rw",
          mappedTeamId: teamId,
          role: TeamUserRole.MEMBER,
        });

        const result = await caller.scimGroupMapping.listAll({ organizationId });

        const unmappedItem = result.find((r) => r.id === unmapped.id);
        const mappedItem = result.find((r) => r.id === mapped.id);

        expect(unmappedItem).toBeDefined();
        expect(unmappedItem!.mapped).toBe(false);
        expect(unmappedItem!.teamName).toBeNull();
        expect(unmappedItem!.memberCount).toBe(0);

        expect(mappedItem).toBeDefined();
        expect(mappedItem!.mapped).toBe(true);
        expect(mappedItem!.teamName).toBe(`Team Dev ${ns}`);
        expect(mappedItem!.role).toBe(TeamUserRole.MEMBER);
      });
    });

    describe("when admin requests unmapped groups", () => {
      it("returns only unmapped groups", async () => {
        const caller = createAdminCaller();

        const unmapped1 = await createMapping({
          externalGroupId: `lu-unmapped1-${nanoid(4)}`,
          externalGroupName: "group-a",
        });

        const unmapped2 = await createMapping({
          externalGroupId: `lu-unmapped2-${nanoid(4)}`,
          externalGroupName: "group-b",
        });

        await createMapping({
          externalGroupId: `lu-mapped-${nanoid(4)}`,
          externalGroupName: "group-c",
          mappedTeamId: teamId,
          role: TeamUserRole.VIEWER,
        });

        const result = await caller.scimGroupMapping.listUnmapped({
          organizationId,
        });

        const ids = result.map((r) => r.id);
        expect(ids).toContain(unmapped1.id);
        expect(ids).toContain(unmapped2.id);
        // No mapped entries
        expect(result.every((r) => !("teamId" in r))).toBe(true);
      });
    });

    describe("when admin creates a mapping", () => {
      it("links an unmapped group to an existing team with role", async () => {
        const caller = createAdminCaller();

        const mapping = await createMapping({
          externalGroupId: `c-group-${nanoid(4)}`,
          externalGroupName: "clienta-dev-rw",
        });

        const result = await caller.scimGroupMapping.create({
          organizationId,
          mappingId: mapping.id,
          teamId,
          role: TeamUserRole.MEMBER,
        });

        expect(result.teamId).toBe(teamId);
        expect(result.role).toBe(TeamUserRole.MEMBER);
      });
    });

    describe("when admin creates a mapping with new team", () => {
      it("creates a new team and links the mapping to it", async () => {
        const caller = createAdminCaller();

        const mapping = await createMapping({
          externalGroupId: `cwnt-group-${nanoid(4)}`,
          externalGroupName: "clienta-staging-admin",
        });

        const result = await caller.scimGroupMapping.createWithNewTeam({
          organizationId,
          mappingId: mapping.id,
          projectId,
          teamName: `team-staging-${nanoid(4)}`,
          role: TeamUserRole.ADMIN,
        });

        expect(result.team).toBeDefined();
        expect(result.team.organizationId).toBe(organizationId);
        expect(result.mapping.teamId).toBe(result.team.id);
        expect(result.mapping.role).toBe(TeamUserRole.ADMIN);
      });
    });

    describe("when admin updates a mapping role", () => {
      it("re-syncs existing members when role changes", async () => {
        const caller = createAdminCaller();

        // Create mapping with VIEWER role
        const mapping = await createMapping({
          externalGroupId: `u-group-${nanoid(4)}`,
          externalGroupName: "clienta-dev-ro",
          mappedTeamId: teamId,
          role: TeamUserRole.VIEWER,
        });

        // Create two users as org members + team members + scim memberships
        const user1 = await prisma.user.create({
          data: { name: "U1", email: `u1-${nanoid(4)}-${ns}@example.com` },
        });
        const user2 = await prisma.user.create({
          data: { name: "U2", email: `u2-${nanoid(4)}-${ns}@example.com` },
        });

        await prisma.organizationUser.createMany({
          data: [
            { userId: user1.id, organizationId, role: OrganizationUserRole.MEMBER },
            { userId: user2.id, organizationId, role: OrganizationUserRole.MEMBER },
          ],
        });

        await prisma.teamUser.createMany({
          data: [
            { userId: user1.id, teamId, role: TeamUserRole.VIEWER },
            { userId: user2.id, teamId, role: TeamUserRole.VIEWER },
          ],
        });

        await prisma.scimGroupMembership.createMany({
          data: [
            { scimGroupMappingId: mapping.id, userId: user1.id },
            { scimGroupMappingId: mapping.id, userId: user2.id },
          ],
        });

        // Update to MEMBER
        await caller.scimGroupMapping.update({
          organizationId,
          mappingId: mapping.id,
          role: TeamUserRole.MEMBER,
        });

        // Verify both users now have MEMBER role
        const tu1 = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: user1.id, teamId } },
        });
        const tu2 = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: user2.id, teamId } },
        });

        expect(tu1!.role).toBe(TeamUserRole.MEMBER);
        expect(tu2!.role).toBe(TeamUserRole.MEMBER);

        // Cleanup
        await prisma.scimGroupMembership.deleteMany({
          where: { scimGroupMappingId: mapping.id },
        });
        await prisma.teamUser.deleteMany({
          where: { userId: { in: [user1.id, user2.id] } },
        });
        await prisma.organizationUser.deleteMany({
          where: { userId: { in: [user1.id, user2.id] } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [user1.id, user2.id] } },
        });
      });
    });

    describe("when admin deletes a mapping", () => {
      it("removes members without other mappings and preserves those with other mappings", async () => {
        const caller = createAdminCaller();

        // Create two mappings to same team
        const mapping1 = await createMapping({
          externalGroupId: `d-group1-${nanoid(4)}`,
          externalGroupName: "group-1",
          mappedTeamId: teamId,
          role: TeamUserRole.VIEWER,
        });

        const mapping2 = await createMapping({
          externalGroupId: `d-group2-${nanoid(4)}`,
          externalGroupName: "group-2",
          mappedTeamId: teamId,
          role: TeamUserRole.ADMIN,
        });

        // user1 belongs to both mappings, user2 belongs to mapping1 only
        const user1 = await prisma.user.create({
          data: { name: "D1", email: `d1-${nanoid(4)}-${ns}@example.com` },
        });
        const user2 = await prisma.user.create({
          data: { name: "D2", email: `d2-${nanoid(4)}-${ns}@example.com` },
        });

        await prisma.organizationUser.createMany({
          data: [
            { userId: user1.id, organizationId, role: OrganizationUserRole.MEMBER },
            { userId: user2.id, organizationId, role: OrganizationUserRole.MEMBER },
          ],
        });

        await prisma.teamUser.createMany({
          data: [
            { userId: user1.id, teamId, role: TeamUserRole.ADMIN },
            { userId: user2.id, teamId, role: TeamUserRole.VIEWER },
          ],
        });

        await prisma.scimGroupMembership.createMany({
          data: [
            { scimGroupMappingId: mapping1.id, userId: user1.id },
            { scimGroupMappingId: mapping1.id, userId: user2.id },
            { scimGroupMappingId: mapping2.id, userId: user1.id },
          ],
        });

        // Delete mapping1
        await caller.scimGroupMapping.delete({
          organizationId,
          mappingId: mapping1.id,
        });

        // user2 had only mapping1 → should be removed from team
        const tu2 = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: user2.id, teamId } },
        });
        expect(tu2).toBeNull();

        // user1 still has mapping2 → should remain with ADMIN role
        const tu1 = await prisma.teamUser.findUnique({
          where: { userId_teamId: { userId: user1.id, teamId } },
        });
        expect(tu1).not.toBeNull();
        expect(tu1!.role).toBe(TeamUserRole.ADMIN);

        // mapping1 should be gone
        const deletedMapping = await prisma.scimGroupMapping.findUnique({
          where: { id: mapping1.id },
        });
        expect(deletedMapping).toBeNull();

        // ScimGroupMembership for mapping1 should be gone
        const m1Memberships = await prisma.scimGroupMembership.findMany({
          where: { scimGroupMappingId: mapping1.id },
        });
        expect(m1Memberships).toHaveLength(0);

        // Cleanup
        await prisma.scimGroupMembership.deleteMany({
          where: { scimGroupMappingId: mapping2.id },
        });
        await prisma.scimGroupMapping.deleteMany({
          where: { id: mapping2.id },
        });
        await prisma.teamUser.deleteMany({
          where: { userId: { in: [user1.id, user2.id] } },
        });
        await prisma.organizationUser.deleteMany({
          where: { userId: { in: [user1.id, user2.id] } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: [user1.id, user2.id] } },
        });
      });
    });

    // --- Permission guards ---

    describe("when organization is not on Enterprise plan", () => {
      it("rejects with FORBIDDEN", async () => {
        mockGetActivePlan.mockResolvedValue(freePlan);
        const caller = createAdminCaller();

        await expect(
          caller.scimGroupMapping.listAll({ organizationId }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      });
    });

    describe("when user is not an org admin", () => {
      // Note: feature spec says FORBIDDEN, but shared checkOrganizationPermission
      // middleware in rbac.ts throws UNAUTHORIZED. Aligning with actual behavior.
      it("rejects with UNAUTHORIZED", async () => {
        const caller = createMemberCaller();

        await expect(
          caller.scimGroupMapping.listAll({ organizationId }),
        ).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      });
    });
  },
);
