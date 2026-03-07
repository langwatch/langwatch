/**
 * @vitest-environment node
 *
 * Integration tests for enterprise-only feature guards.
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
import { ENTERPRISE_FEATURE_ERRORS } from "../../enterprise";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "enterprise feature guards",
  () => {
    const testNamespace = `ent-guard-${nanoid(8)}`;
    let organizationId: string;
    let userId: string;
    let teamId: string;
    let customRoleId: string;
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
          name: "Test Enterprise Org",
          slug: `--test-org-${testNamespace}`,
        },
      });
      organizationId = organization.id;

      const user = await prisma.user.create({
        data: {
          name: "Test User",
          email: `test-${testNamespace}@example.com`,
        },
      });
      userId = user.id;

      await prisma.organizationUser.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: OrganizationUserRole.ADMIN,
        },
      });

      const team = await prisma.team.create({
        data: {
          name: "Test Team",
          slug: `--test-team-${testNamespace}`,
          organizationId: organization.id,
        },
      });
      teamId = team.id;

      await prisma.teamUser.create({
        data: {
          userId: user.id,
          teamId: team.id,
          role: TeamUserRole.ADMIN,
        },
      });

      // Create a custom role for tests that need one
      const role = await prisma.customRole.create({
        data: {
          name: `Test Role ${testNamespace}`,
          description: "Test role for enterprise guard tests",
          permissions: ["analytics:view"],
          organizationId: organization.id,
        },
      });
      customRoleId = role.id;
    });

    beforeEach(() => {
      resetApp();
      mockGetActivePlan = vi.fn();
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
      await prisma.teamUser
        .deleteMany({
          where: {
            team: { slug: { startsWith: `--test-team-${testNamespace}` } },
          },
        })
        .catch(() => {});
      await prisma.team
        .deleteMany({
          where: { slug: { startsWith: `--test-team-${testNamespace}` } },
        })
        .catch(() => {});
      await prisma.customRole
        .deleteMany({
          where: {
            organization: { slug: `--test-org-${testNamespace}` },
          },
        })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({
          where: { organization: { slug: `--test-org-${testNamespace}` } },
        })
        .catch(() => {});
      await prisma.organization
        .deleteMany({
          where: { slug: `--test-org-${testNamespace}` },
        })
        .catch(() => {});
      await prisma.user
        .deleteMany({
          where: { email: `test-${testNamespace}@example.com` },
        })
        .catch(() => {});
    });

    function createCaller() {
      const ctx = createInnerTRPCContext({
        session: {
          user: { id: userId },
          expires: "1",
        },
      });
      return appRouter.createCaller(ctx);
    }

    // --- role.create ---

    describe("role.create", () => {
      describe("when plan is not enterprise", () => {
        it("rejects with FORBIDDEN", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.role.create({
              organizationId,
              name: `Blocked Role ${nanoid(4)}`,
              permissions: ["analytics:view"],
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        });
      });

      describe("when plan is enterprise", () => {
        it("allows creation", async () => {
          mockGetActivePlan.mockResolvedValue(enterprisePlan);
          const caller = createCaller();

          const result = await caller.role.create({
            organizationId,
            name: `Allowed Role ${nanoid(4)}`,
            permissions: ["analytics:view"],
          });

          expect(result).toBeDefined();
          expect(result.name).toContain("Allowed Role");
        });
      });
    });

    // --- role.update ---

    describe("role.update", () => {
      describe("when plan is not enterprise", () => {
        it("rejects with FORBIDDEN", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.role.update({
              roleId: customRoleId,
              name: "Updated Name",
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        });
      });

      describe("when plan is enterprise", () => {
        it("allows update", async () => {
          mockGetActivePlan.mockResolvedValue(enterprisePlan);
          const caller = createCaller();

          const result = await caller.role.update({
            roleId: customRoleId,
            name: `Updated Role ${nanoid(4)}`,
          });

          expect(result).toBeDefined();
        });
      });
    });

    // --- role.assignToUser ---

    describe("role.assignToUser", () => {
      describe("when plan is not enterprise", () => {
        it("rejects with FORBIDDEN", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.role.assignToUser({
              userId,
              teamId,
              customRoleId,
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        });
      });

      describe("when plan is enterprise", () => {
        it("allows assignment", async () => {
          mockGetActivePlan.mockResolvedValue(enterprisePlan);
          const caller = createCaller();

          const result = await caller.role.assignToUser({
            userId,
            teamId,
            customRoleId,
          });

          expect(result).toBeDefined();
        });
      });
    });

    // --- role.removeFromUser is NOT gated ---

    describe("role.removeFromUser", () => {
      describe("when plan is not enterprise", () => {
        it("allows removal on free plan", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);

          // First assign the role on enterprise
          mockGetActivePlan.mockResolvedValueOnce(enterprisePlan);
          const setupCaller = createCaller();
          await setupCaller.role.assignToUser({
            userId,
            teamId,
            customRoleId,
          });

          // Now switch to free plan and remove
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          const result = await caller.role.removeFromUser({
            userId,
            teamId,
            customRoleId,
          });

          expect(result).toBeDefined();
        });
      });
    });

    // --- role.delete is NOT gated ---

    describe("role.delete", () => {
      describe("when plan is not enterprise", () => {
        it("allows deletion on free plan", async () => {
          // Create a role to delete (needs enterprise)
          mockGetActivePlan.mockResolvedValue(enterprisePlan);
          const setupCaller = createCaller();
          const role = await setupCaller.role.create({
            organizationId,
            name: `Deletable Role ${nanoid(4)}`,
            permissions: ["analytics:view"],
          });

          // Now switch to free plan and delete
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          const result = await caller.role.delete({ roleId: role.id });
          expect(result).toBeDefined();
        });
      });
    });

    // --- role.getAll is NOT gated ---

    describe("role.getAll", () => {
      describe("when plan is not enterprise", () => {
        it("allows listing on free plan", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          const result = await caller.role.getAll({ organizationId });
          expect(Array.isArray(result)).toBe(true);
        });
      });
    });

    // --- getAuditLogs ---

    describe("organization.getAuditLogs", () => {
      describe("when plan is not enterprise", () => {
        it("rejects with FORBIDDEN", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.organization.getAuditLogs({
              organizationId,
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
          });
        });
      });

      describe("when plan is enterprise", () => {
        it("allows access", async () => {
          mockGetActivePlan.mockResolvedValue(enterprisePlan);
          const caller = createCaller();

          const result = await caller.organization.getAuditLogs({
            organizationId,
          });

          expect(result).toBeDefined();
        });
      });
    });

    // --- team.createTeamWithMembers conditional guard ---

    describe("team.createTeamWithMembers", () => {
      describe("when members include custom role on non-enterprise plan", () => {
        it("rejects with FORBIDDEN", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.team.createTeamWithMembers({
              organizationId,
              name: `Guarded Team ${nanoid(4)}`,
              members: [
                {
                  userId,
                  role: `custom:${customRoleId}`,
                  customRoleId,
                },
              ],
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        });
      });

      describe("when members use only built-in roles on non-enterprise plan", () => {
        it("allows creation", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          const result = await caller.team.createTeamWithMembers({
            organizationId,
            name: `Builtin Team ${nanoid(4)}`,
            members: [{ userId, role: "ADMIN" }],
          });

          expect(result).toBeDefined();
          expect(result.name).toContain("Builtin Team");
        });
      });
    });

    // --- team.update conditional guard ---

    describe("team.update", () => {
      describe("when members include custom role on non-enterprise plan", () => {
        it("rejects with FORBIDDEN", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.team.update({
              teamId,
              name: "Updated Team",
              members: [
                {
                  userId,
                  role: `custom:${customRoleId}`,
                  customRoleId,
                },
              ],
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        });
      });

      describe("when members use only built-in roles on non-enterprise plan", () => {
        it("allows update", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          const result = await caller.team.update({
            teamId,
            name: "Updated Team Name",
            members: [{ userId, role: "ADMIN" }],
          });

          expect(result).toMatchObject({ success: true });
        });
      });
    });

    // --- updateMemberRole conditional guard ---

    describe("organization.updateMemberRole", () => {
      describe("when teamRoleUpdates include custom role on non-enterprise plan", () => {
        it("rejects with FORBIDDEN", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.organization.updateMemberRole({
              userId,
              organizationId,
              role: OrganizationUserRole.ADMIN,
              teamRoleUpdates: [
                {
                  teamId,
                  userId,
                  role: `custom:${customRoleId}`,
                  customRoleId,
                },
              ],
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        });
      });

      describe("when teamRoleUpdates use only built-in roles on non-enterprise plan", () => {
        it("allows update", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          const result = await caller.organization.updateMemberRole({
            userId,
            organizationId,
            role: OrganizationUserRole.ADMIN,
            teamRoleUpdates: [
              {
                teamId,
                userId,
                role: TeamUserRole.ADMIN,
              },
            ],
          });

          expect(result).toBeDefined();
        });
      });
    });

    // --- createInvites conditional guard ---

    describe("organization.createInvites", () => {
      describe("when invites include custom role on non-enterprise plan", () => {
        it("rejects the entire batch", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          await expect(
            caller.organization.createInvites({
              organizationId,
              invites: [
                {
                  email: `invite-${nanoid(4)}@example.com`,
                  role: OrganizationUserRole.MEMBER,
                  teams: [
                    {
                      teamId,
                      role: `custom:${customRoleId}`,
                      customRoleId,
                    },
                  ],
                },
              ],
            }),
          ).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: ENTERPRISE_FEATURE_ERRORS.RBAC,
          });
        });
      });

      describe("when invites use only built-in roles on non-enterprise plan", () => {
        it("allows creation", async () => {
          mockGetActivePlan.mockResolvedValue(freePlan);
          const caller = createCaller();

          const result = await caller.organization.createInvites({
            organizationId,
            invites: [
              {
                email: `invite-builtin-${nanoid(4)}@example.com`,
                role: OrganizationUserRole.MEMBER,
                teams: [
                  {
                    teamId,
                    role: TeamUserRole.MEMBER,
                  },
                ],
              },
            ],
          });

          expect(result).toBeDefined();
        });
      });
    });

    // --- Fail closed behavior ---

    describe("when plan provider fails", () => {
      it("denies access to role.create", async () => {
        mockGetActivePlan.mockRejectedValue(
          new Error("Plan provider unavailable"),
        );
        const caller = createCaller();

        await expect(
          caller.role.create({
            organizationId,
            name: `Fail Closed Role ${nanoid(4)}`,
            permissions: ["analytics:view"],
          }),
        ).rejects.toThrow();
      });
    });
  },
);
