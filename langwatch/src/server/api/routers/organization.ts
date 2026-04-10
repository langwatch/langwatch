import {
  OrganizationUserRole,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "~/env.mjs";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import {
  LicenseEnforcementRepository,
} from "../../license-enforcement/license-enforcement.repository";
import { getRoleChangeType } from "../../license-enforcement/member-classification";
import { assertMemberTypeLimitNotExceeded } from "../../license-enforcement/license-limit-guard";
import { scheduleUsageStatsForOrganization } from "~/server/background/queues/usageStatsQueue";
import { decrypt } from "~/utils/encryption";
import { isTeamRoleAllowedForOrganizationRole, type TeamRoleValue } from "~/utils/memberRoleConstraints";
import { getApp } from "~/server/app-layer/app";
import { elasticsearchMigrate } from "../../../tasks/elasticMigrate";
import {
  assertEnterprisePlan,
  assertEnterprisePlanType,
  isCustomRole,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import { skipPermissionCheck } from "../rbac";
import { checkOrganizationPermission, checkTeamPermission } from "../rbac";
import { signUpDataSchema } from "./onboarding";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "~/server/app-layer/organizations/compute-effective-team-role-updates";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";


import { teamRoleInputSchema } from "./schemas/teamRole";

export const organizationRouter = createTRPCRouter({
  createAndAssign: protectedProcedure
    .input(
      z.object({
        orgName: z.string().optional(),
        phoneNumber: z.string().optional(),
        signUpData: signUpDataSchema.optional(),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      const result = await getApp().organizations.createAndAssign({
        userId: ctx.session.user.id,
        orgName: input.orgName,
        phoneNumber: input.phoneNumber,
        signUpData: input.signUpData,
        userDisplayName: ctx.session.user.name,
      });

      await scheduleUsageStatsForOrganization(result.organization);

      return {
        success: true,
        organization: result.organization,
        team: result.team,
      };
    }),

  deleteMember: protectedProcedure
    .input(z.object({ userId: z.string(), organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself from the organization",
        });
      }

      await getApp().organizations.deleteMember({
        organizationId: input.organizationId,
        userId: input.userId,
      });

      return { success: true };
    }),

  getAll: protectedProcedure
    .input(
      z.object({
        isDemo: z.boolean().optional(),
      }),
    )
    .use(skipPermissionCheck)
    .query(async ({ ctx, input }) => {
      const isDemo = input?.isDemo ?? false;
      const userId = ctx.session.user.id;
      const demoProjectUserId = isDemo ? env.DEMO_PROJECT_USER_ID : "";
      const demoProjectId = isDemo ? env.DEMO_PROJECT_ID : "";

      const organizations = (await getApp().organizations.getAllForUser({
        userId,
        isDemo,
        demoProjectUserId,
        demoProjectId,
      })) as FullyLoadedOrganization[];

      for (const organization of organizations) {
        for (const project of organization.teams.flatMap(
          (team) => team.projects,
        )) {
          if (project.s3AccessKeyId) {
            project.s3AccessKeyId = decrypt(project.s3AccessKeyId);
          }
          if (project.s3SecretAccessKey) {
            project.s3SecretAccessKey = decrypt(project.s3SecretAccessKey);
          }
          if (project.s3Endpoint) {
            project.s3Endpoint = decrypt(project.s3Endpoint);
          }
          if (isDemo) {
            project.apiKey = "";
          }
        }
      }
      for (const organization of organizations) {
        const isDemoOrg =
          isDemo &&
          organization.teams.some((team) =>
            team.projects.some((project) => project.id === demoProjectId),
          );

        organization.members = organization.members.filter(
          (member) =>
            member.userId === userId || member.userId === demoProjectUserId,
        );
        if (organization.s3AccessKeyId) {
          organization.s3AccessKeyId = decrypt(organization.s3AccessKeyId);
        }
        if (organization.s3SecretAccessKey) {
          organization.s3SecretAccessKey = decrypt(
            organization.s3SecretAccessKey,
          );
        }
        if (organization.s3Endpoint) {
          organization.s3Endpoint = decrypt(organization.s3Endpoint);
        }
        if (organization.elasticsearchNodeUrl) {
          organization.elasticsearchNodeUrl = decrypt(
            organization.elasticsearchNodeUrl,
          );
        }
        if (organization.elasticsearchApiKey) {
          organization.elasticsearchApiKey = decrypt(
            organization.elasticsearchApiKey,
          );
        }

        const isExternal =
          organization.members[0]?.role !== "ADMIN" &&
          organization.members[0]?.role !== "MEMBER";

        organization.teams = organization.teams.filter((team) => {
          team.members = team.members.filter(
            (member) =>
              member.userId === userId || member.userId === demoProjectUserId,
          );
          if (isDemoOrg) return true;
          return isExternal
            ? team.members.some((member) => member.userId === userId)
            : true;
        });

        if (isDemoOrg) {
          organization.teams = organization.teams.flatMap((team) => {
            if (team.projects.some((project) => project.id === demoProjectId)) {
              team.projects = team.projects.filter(
                (project) => project.id === demoProjectId,
              );

              team.members = team.members.filter(
                (member) =>
                  member.userId === demoProjectUserId ||
                  member.userId === userId,
              );
              return [team];
            } else {
              return [];
            }
          });
        }
      }

      return organizations;
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          organizationId: z.string(),
          name: z.string(),
          s3Endpoint: z.string().optional(),
          s3AccessKeyId: z.string().optional(),
          s3SecretAccessKey: z.string().optional(),
          elasticsearchNodeUrl: z.string().optional(),
          elasticsearchApiKey: z.string().optional(),
          s3Bucket: z.string().optional(),
        })
        .refine((data) => {
          const hasNodeUrl = !!data.elasticsearchNodeUrl?.trim();
          const hasApiKey = !!data.elasticsearchApiKey?.trim();
          return (hasNodeUrl && hasApiKey) || (!hasNodeUrl && !hasApiKey);
        })
        .refine(
          (data) => {
            const hasEndpoint = !!data.s3Endpoint?.trim();
            const hasAccessKey = !!data.s3AccessKeyId?.trim();
            const hasSecretKey = !!data.s3SecretAccessKey?.trim();

            return (
              (hasEndpoint && hasAccessKey && hasSecretKey) ||
              (!hasEndpoint && !hasAccessKey && !hasSecretKey)
            );
          },
          {
            message:
              "S3 Endpoint, Access Key ID, and Secret Access Key must all be provided together",
          },
        ),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const organizationUser = await prisma.organizationUser.findFirst({
        where: {
          userId: ctx.session.user.id,
          organizationId: input.organizationId,
          role: "ADMIN",
        },
      });

      if (!organizationUser) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You don't have the necessary permissions",
        });
      }

      await getApp().organizations.update({
        organizationId: input.organizationId,
        name: input.name,
        s3Endpoint: input.s3Endpoint,
        s3AccessKeyId: input.s3AccessKeyId,
        s3SecretAccessKey: input.s3SecretAccessKey,
        elasticsearchNodeUrl: input.elasticsearchNodeUrl,
        elasticsearchApiKey: input.elasticsearchApiKey,
        s3Bucket: input.s3Bucket,
      });

      if (input.elasticsearchNodeUrl && input.elasticsearchApiKey) {
        await elasticsearchMigrate(input.organizationId);
      }

      return { success: true };
    }),

  getOrganizationWithMembersAndTheirTeams: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        includeDeactivated: z.boolean().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const organization = await getApp().organizations.getOrganizationWithMembers({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
        includeDeactivated: input.includeDeactivated ?? false,
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      return organization;
    }),

  getMemberById: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        userId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const member = await getApp().organizations.getMemberById({
        organizationId: input.organizationId,
        userId: input.userId,
        currentUserId: ctx.session.user.id,
      });

      if (!member) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      return member;
    }),

  updateTeamMemberRole: protectedProcedure
    .input(
      z
        .object({
          teamId: z.string(),
          userId: z.string(),
          role: teamRoleInputSchema,
          customRoleId: z.string().optional(),
        })
        .superRefine((data, ctx) => {
          const hasCustom = isCustomRole(data.role);

          if (hasCustom) {
            if (!data.customRoleId || data.customRoleId.trim() === "") {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "customRoleId is required when using a custom role",
                path: ["customRoleId"],
              });
            }
          } else {
            if (data.customRoleId !== undefined) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                  "customRoleId must not be provided when using a built-in role",
                path: ["customRoleId"],
              });
            }
          }
        }),
    )
    .use(checkTeamPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const inputIsCustomRole = isCustomRole(input.role);

      if (inputIsCustomRole && input.customRoleId) {
        // Check enterprise plan before allowing custom role assignment
        const teamForPlanCheck = await prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organizationId: true },
        });
        if (!teamForPlanCheck) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }
        await assertEnterprisePlan({
          organizationId: teamForPlanCheck.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      } else if (!inputIsCustomRole) {
        // Built-in role path: check license limits for EXTERNAL users
        const team = await prisma.team.findUnique({
          where: { id: input.teamId },
          select: { organizationId: true },
        });
        if (!team) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Team not found",
          });
        }

        const orgMembership = await prisma.organizationUser.findUnique({
          where: {
            userId_organizationId: {
              userId: input.userId,
              organizationId: team.organizationId,
            },
          },
        });

        if (orgMembership?.role === OrganizationUserRole.EXTERNAL) {
          if (
            !isTeamRoleAllowedForOrganizationRole({
              organizationRole: OrganizationUserRole.EXTERNAL,
              teamRole: input.role as TeamRoleValue,
            })
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: LITE_MEMBER_VIEWER_ONLY_ERROR,
            });
          }

          const currentTeamUser = await prisma.teamUser.findUnique({
            where: {
              userId_teamId: {
                userId: input.userId,
                teamId: input.teamId,
              },
            },
            select: { assignedRoleId: true },
          });

          const oldPermissions = currentTeamUser?.assignedRoleId
            ? await (async () => {
                const role = await prisma.customRole.findUnique({
                  where: { id: currentTeamUser.assignedRoleId! },
                  select: { permissions: true },
                });
                return role?.permissions as string[] | undefined;
              })()
            : undefined;

          const changeType = getRoleChangeType(
            OrganizationUserRole.EXTERNAL,
            oldPermissions,
            OrganizationUserRole.EXTERNAL,
            undefined,
          );

          const subscriptionLimits = await getApp().planProvider.getActivePlan({
            organizationId: team.organizationId,
            user: ctx.session.user,
          });
          const licenseRepo = new LicenseEnforcementRepository(prisma);
          await assertMemberTypeLimitNotExceeded(
            changeType,
            team.organizationId,
            licenseRepo,
            subscriptionLimits,
          );
        }
      }

      await getApp().organizations.updateTeamMemberRole({
        teamId: input.teamId,
        userId: input.userId,
        role: input.role,
        customRoleId: input.customRoleId,
        currentUserId: ctx.session.user.id,
      });

      return { success: true };
    }),
  getAllOrganizationMembers: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input }) => {
      return getApp().organizations.getAllMembers(input.organizationId);
    }),
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        organizationId: z.string(),
        role: z.nativeEnum(OrganizationUserRole),
        teamRoleUpdates: z
          .array(
            z.object({
              teamId: z.string(),
              userId: z.string(),
              role: teamRoleInputSchema,
              customRoleId: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      // Fetch current member to enable license checks
      const currentMember = await prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: {
            userId: input.userId,
            organizationId: input.organizationId,
          },
        },
      });

      if (!currentMember) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member not found",
        });
      }

      // Get current member's custom role permissions (if any) for license change detection
      const organizationTeams = await prisma.team.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true },
      });
      const organizationTeamIds = organizationTeams.map((team) => team.id);

      const currentMemberships = await prisma.teamUser.findMany({
        where: {
          userId: input.userId,
          teamId: { in: organizationTeamIds },
        },
        select: { teamId: true, role: true, assignedRoleId: true },
      });

      const userPermissions = await (async () => {
        const teamIds = organizationTeamIds;
        if (teamIds.length === 0) return undefined;
        const teamUsers = await prisma.teamUser.findMany({
          where: {
            userId: input.userId,
            teamId: { in: teamIds },
            assignedRoleId: { not: null },
          },
          include: { assignedRole: true },
        });
        const allPermissions: string[] = [];
        for (const tu of teamUsers) {
          if (tu.assignedRole?.permissions) {
            allPermissions.push(...(tu.assignedRole.permissions as string[]));
          }
        }
        return allPermissions.length > 0 ? allPermissions : undefined;
      })();

      const changeType = getRoleChangeType(
        currentMember.role,
        userPermissions,
        input.role,
        undefined,
      );

      const subscriptionLimits = await getApp().planProvider.getActivePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
      });
      const licenseRepo = new LicenseEnforcementRepository(prisma);
      await assertMemberTypeLimitNotExceeded(
        changeType,
        input.organizationId,
        licenseRepo,
        subscriptionLimits,
      );

      const hasCustomRoleAssignment = (input.teamRoleUpdates ?? []).some(
        (update) =>
          typeof update.role === "string" && isCustomRole(update.role),
      );
      if (hasCustomRoleAssignment) {
        assertEnterprisePlanType({
          planType: subscriptionLimits.type,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      await getApp().organizations.updateMemberRole({
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        teamRoleUpdates: input.teamRoleUpdates,
        currentMemberships: currentMemberships.map((m) => ({
          teamId: m.teamId,
          role: m.role,
        })),
        organizationTeamIds,
        currentUserId: ctx.session.user.id,
      });

      return { success: true };
    }),

  getAuditLogs: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        projectId: z.string().optional(),
        userId: z.string().optional(),
        pageOffset: z.number().min(0).default(0),
        pageSize: z.number().min(1).max(10000).default(25),
        action: z.string().optional(),
        startDate: z.number().optional(),
        endDate: z.number().optional(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      await assertEnterprisePlan({
        organizationId: input.organizationId,
        user: ctx.session.user,
        errorMessage: ENTERPRISE_FEATURE_ERRORS.AUDIT_LOGS,
      });

      return getApp().organizations.getAuditLogs({
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        pageOffset: input.pageOffset,
        pageSize: input.pageSize,
        action: input.action,
        startDate: input.startDate,
        endDate: input.endDate,
      });
    }),
});
