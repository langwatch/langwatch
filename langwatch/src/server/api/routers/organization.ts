import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { generate } from "@langwatch/ksuid";
import { KSUID_RESOURCES } from "~/utils/constants";

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
import { trackServerEvent } from "~/server/posthog";
import { fireTeamMemberInvitedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { elasticsearchMigrate } from "../../../tasks/elasticMigrate";
import {
  InviteService,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
} from "../../invites/invite.service";
import {
  DuplicateInviteError,
  InviteNotFoundError,
  OrganizationNotFoundError,
} from "../../invites/errors";
import {
  assertEnterprisePlan,
  assertEnterprisePlanType,
  isCustomRole,
  ENTERPRISE_FEATURE_ERRORS,
} from "../enterprise";
import { LimitExceededError } from "../../license-enforcement/errors";
import { captureException } from "~/utils/posthogErrorCapture";
import { skipPermissionCheck } from "../rbac";
import { checkOrganizationPermission, checkTeamPermission } from "../rbac";
import { signUpDataSchema } from "./onboarding";
import { LITE_MEMBER_VIEWER_ONLY_ERROR } from "~/server/app-layer/organizations/compute-effective-team-role-updates";
import type { FullyLoadedOrganization } from "~/server/app-layer/organizations/repositories/organization.repository";


const customTeamRoleInputSchema = z
  .string()
  .regex(
    /^custom:[a-zA-Z0-9_-]+$/,
    "Custom role must be in format 'custom:{roleId}'",
  );
const builtInTeamRoleInputSchema = z.enum([
  TeamUserRole.ADMIN,
  TeamUserRole.MEMBER,
  TeamUserRole.VIEWER,
]);
const teamRoleInputSchema = z.union([
  builtInTeamRoleInputSchema,
  customTeamRoleInputSchema,
]);

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

  createInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        invites: z.array(
          z.object({
            email: z.string().email(),
            teamIds: z.string().optional(), // Keep for backward compatibility
            teams: z
              .array(
                z.object({
                  teamId: z.string(),
                  role: teamRoleInputSchema,
                  customRoleId: z.string().optional(),
                }),
              )
              .optional(),
            role: z.nativeEnum(OrganizationUserRole),
          }),
        ),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const hasCustomRoleInvite = input.invites.some((invite) =>
        (invite.teams ?? []).some(
          (t) => typeof t.role === "string" && isCustomRole(t.role),
        ),
      );
      if (hasCustomRoleInvite) {
        await assertEnterprisePlan({
          organizationId: input.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      const prisma = ctx.prisma;

      const organization = await prisma.organization.findFirst({
        where: {
          id: input.organizationId,
        },
        include: {
          members: true,
        },
      });

      if (!organization) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found",
        });
      }

      const inviteService = InviteService.create(prisma);

      // Check license limits using the service
      try {
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: input.invites.map((invite) => ({
            role: invite.role,
            teams: invite.teams,
          })),
          user: ctx.session.user,
        });
      } catch (error) {
        if (error instanceof LimitExceededError) {
          void getApp()
            .usageLimits.notifyResourceLimitReached({
              organizationId: input.organizationId,
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            })
            .catch(captureException);

          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        throw error;
      }
      // Prepare invite data (read-only validation) outside transaction
      const preparedAdminInvites = await Promise.all(
        input.invites.map(async (invite) => {
          let teamAssignments: Array<{
            teamId: string;
            role: TeamUserRole;
            customRoleId?: string;
          }> = [];
          let teamIdsString = "";

          if (invite.teams && invite.teams.length > 0) {
            const teamIds = invite.teams.map((t) => t.teamId);

            const validTeams = await prisma.team.findMany({
              where: {
                id: { in: teamIds },
                organizationId: input.organizationId,
              },
              select: { id: true },
            });

            const validTeamIds = validTeams.map((team) => team.id);

            if (validTeamIds.length === 0) {
              return null;
            }

            teamAssignments = invite.teams
              .filter((t) => validTeamIds.includes(t.teamId))
              .map((t) => {
                const hasCustom =
                  typeof t.role === "string" && isCustomRole(t.role);
                return {
                  teamId: t.teamId,
                  role: hasCustom
                    ? TeamUserRole.CUSTOM
                    : (t.role as TeamUserRole),
                  customRoleId:
                    hasCustom && t.customRoleId ? t.customRoleId : undefined,
                };
              })
              .filter((t) => {
                if (t.role === TeamUserRole.CUSTOM && !t.customRoleId) {
                  return false;
                }
                return true;
              });

            // Validate custom role IDs belong to this organization
            const customRoleIds = teamAssignments
              .filter((t) => t.customRoleId)
              .map((t) => t.customRoleId!);
            if (customRoleIds.length > 0) {
              const validCustomRoles = await prisma.customRole.findMany({
                where: {
                  id: { in: customRoleIds },
                  organizationId: input.organizationId,
                },
                select: { id: true },
              });
              const validCustomRoleIds = new Set(
                validCustomRoles.map((r) => r.id),
              );
              const invalidRoleIds = customRoleIds.filter(
                (id) => !validCustomRoleIds.has(id),
              );
              if (invalidRoleIds.length > 0) {
                return null; // Skip this invite — invalid custom role
              }
            }

            teamIdsString = validTeamIds.join(",");
          } else if (invite.teamIds?.trim()) {
            const teamIdArray = invite.teamIds
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);

            const validTeams = await prisma.team.findMany({
              where: {
                id: { in: teamIdArray },
                organizationId: input.organizationId,
              },
              select: { id: true },
            });

            const validTeamIds = validTeams.map((team) => team.id);

            if (validTeamIds.length === 0) {
              return null;
            }

            teamAssignments = validTeamIds.map((teamId) => ({
              teamId,
              role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
            }));

            teamIdsString = validTeamIds.join(",");
          } else {
            return null;
          }

          if (!invite.email.trim()) {
            return null;
          }

          return {
            email: invite.email,
            role: invite.role,
            organizationId: input.organizationId,
            teamIds: teamIdsString,
            teamAssignments:
              teamAssignments.length > 0 ? teamAssignments : undefined,
          };
        }),
      );

      const validInvites = preparedAdminInvites.filter(
        (inv): inv is NonNullable<typeof inv> => inv !== null,
      );

      // Phase 1: DB operations in transaction (no side-effects)
      const inviteRecords = await prisma.$transaction(async (tx) => {
        const txInviteService = InviteService.create(tx);
        return Promise.all(
          validInvites.map(async (invite) => {
            const existingInvite = await txInviteService.checkDuplicateInvite({
              email: invite.email,
              organizationId: invite.organizationId,
            });

            if (existingInvite) {
              return null;
            }

            return await txInviteService.createAdminInviteRecord(invite);
          }),
        );
      });

      // Phase 2: Send emails outside transaction
      const createdRecords = inviteRecords.filter(
        (r): r is NonNullable<typeof r> => r !== null,
      );

      if (createdRecords.length > 0) {
        trackServerEvent({
          userId: ctx.session.user.id,
          event: "team_member_invited",
          properties: { inviteCount: createdRecords.length },
          session: ctx.session,
        });

        const memberCount = organization.members.length + createdRecords.length;
        for (const record of createdRecords) {
          fireTeamMemberInvitedNurturing({
            userId: ctx.session.user.id,
            teamMemberCount: memberCount,
            role: record.invite.role,
          });
        }
      }

      const invites = await Promise.all(
        createdRecords.map(async (record) => {
          const { emailNotSent } = await inviteService.trySendInviteEmail({
            email: record.invite.email,
            organization: record.organization,
            inviteCode: record.invite.inviteCode,
          });
          return { invite: record.invite, emailNotSent };
        }),
      );

      return invites;
    }),
  deleteInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.organizationInvite.delete({
        where: { id: input.inviteId, organizationId: input.organizationId },
      });
    }),
  getOrganizationPendingInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input, ctx }) => {
      const prisma = ctx.prisma;

      const invites = await prisma.organizationInvite.findMany({
        where: {
          organizationId: input.organizationId,
          status: { in: ["PENDING", "WAITING_APPROVAL"] },
          OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
        },
        include: {
          requestedByUser: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return invites;
    }),
  createInviteRequest: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        invites: z.array(
          z.object({
            email: z.string().email(),
            role: z.enum(["MEMBER", "EXTERNAL"]),
            teamIds: z.string().optional(),
            teams: z
              .array(
                z.object({
                  teamId: z.string(),
                  role: z.union([
                    z.nativeEnum(TeamUserRole),
                    z
                      .string()
                      .regex(
                        /^custom:[a-zA-Z0-9_-]+$/,
                        "Custom role must be in format 'custom:{roleId}'",
                      ),
                  ]),
                  customRoleId: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .mutation(async ({ input, ctx }) => {
      const hasCustomRoleInvite = input.invites.some((invite) =>
        (invite.teams ?? []).some(
          (t) => typeof t.role === "string" && isCustomRole(t.role),
        ),
      );
      if (hasCustomRoleInvite) {
        await assertEnterprisePlan({
          organizationId: input.organizationId,
          user: ctx.session.user,
          errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
        });
      }

      const prisma = ctx.prisma;
      const inviteService = InviteService.create(prisma);

      try {
        // Check license limits for all invites at once
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: input.invites.map((invite) => ({
            role: invite.role as OrganizationUserRole,
            teams: invite.teams,
          })),
          user: ctx.session.user,
        });

        const normalizedPayloadEmails = input.invites.map((invite) =>
          invite.email.trim().toLowerCase(),
        );
        const duplicatePayloadEmails = normalizedPayloadEmails.filter(
          (email, index) => normalizedPayloadEmails.indexOf(email) !== index,
        );

        if (duplicatePayloadEmails.length > 0) {
          const uniqueDuplicatePayloadEmails = [
            ...new Set(duplicatePayloadEmails),
          ];
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Duplicate emails in request payload: ${uniqueDuplicatePayloadEmails.join(", ")}`,
          });
        }

        const preparedInvites = await Promise.all(
          input.invites.map(async (invite) => {
            const normalizedEmail = invite.email.trim().toLowerCase();

            // Validate team IDs
            let teamIdsString = "";
            let teamAssignments: Array<{
              teamId: string;
              role: TeamUserRole;
              customRoleId?: string;
            }> = [];

            if (invite.teams && invite.teams.length > 0) {
              const teamIds = invite.teams.map((t) => t.teamId);
              const validTeamIds = await inviteService.validateTeamIds({
                teamIds,
                organizationId: input.organizationId,
              });

              if (validTeamIds.length === 0) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "No valid teams provided",
                });
              }

              teamAssignments = invite.teams
                .filter((t) => validTeamIds.includes(t.teamId))
                .map((t) => {
                  const hasCustom =
                    typeof t.role === "string" && isCustomRole(t.role);
                  return {
                    teamId: t.teamId,
                    role: hasCustom
                      ? ("CUSTOM" as TeamUserRole)
                      : (t.role as TeamUserRole),
                    customRoleId:
                      hasCustom && t.customRoleId
                        ? t.customRoleId
                        : undefined,
                  };
                });

              // Validate custom role IDs belong to this organization
              const customRoleIds = teamAssignments
                .filter((t) => t.customRoleId)
                .map((t) => t.customRoleId!);
              if (customRoleIds.length > 0) {
                const validCustomRoles = await prisma.customRole.findMany({
                  where: {
                    id: { in: customRoleIds },
                    organizationId: input.organizationId,
                  },
                  select: { id: true },
                });
                const validCustomRoleIds = new Set(
                  validCustomRoles.map((r) => r.id),
                );
                const invalidRoleIds = customRoleIds.filter(
                  (id) => !validCustomRoleIds.has(id),
                );
                if (invalidRoleIds.length > 0) {
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `Custom role(s) ${invalidRoleIds.join(", ")} not found in this organization`,
                  });
                }
              }

              teamIdsString = validTeamIds.join(",");
            } else if (invite.teamIds?.trim()) {
              const teamIdArray = invite.teamIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);

              const validTeamIds = await inviteService.validateTeamIds({
                teamIds: teamIdArray,
                organizationId: input.organizationId,
              });

              if (validTeamIds.length === 0) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "No valid teams provided",
                });
              }

              teamAssignments = validTeamIds.map((teamId) => ({
                teamId,
                role: ORGANIZATION_TO_TEAM_ROLE_MAP[
                  invite.role as OrganizationUserRole
                ],
              }));

              teamIdsString = validTeamIds.join(",");
            } else {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "At least one team must be provided",
              });
            }

            return {
              email: normalizedEmail,
              role: invite.role as OrganizationUserRole,
              organizationId: input.organizationId,
              teamIds: teamIdsString,
              teamAssignments:
                teamAssignments.length > 0 ? teamAssignments : undefined,
              requestedBy: ctx.session.user.id,
            };
          }),
        );

        const results = await prisma.$transaction(async (tx) => {
          const transactionalInviteService = InviteService.create(tx);
          return Promise.all(
            preparedInvites.map((invite) =>
              transactionalInviteService.createMemberInviteRequest(invite),
            ),
          );
        });

        return results;
      } catch (error) {
        if (error instanceof LimitExceededError) {
          void getApp()
            .usageLimits.notifyResourceLimitReached({
              organizationId: input.organizationId,
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            })
            .catch(captureException);

          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        if (error instanceof DuplicateInviteError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }
    }),
  approveInvite: protectedProcedure
    .input(
      z.object({
        inviteId: z.string(),
        organizationId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const inviteService = InviteService.create(prisma);

      try {
        // Re-validate license limits before approving (org may have reached cap since request)
        const invite = await prisma.organizationInvite.findFirst({
          where: {
            id: input.inviteId,
            organizationId: input.organizationId,
            status: "WAITING_APPROVAL",
          },
        });

        if (!invite) {
          throw new InviteNotFoundError();
        }

        const teamAssignments =
          (invite.teamAssignments as Array<{ customRoleId?: string }>) ?? [];
        await inviteService.checkLicenseLimits({
          organizationId: input.organizationId,
          newInvites: [{ role: invite.role, teams: teamAssignments }],
          user: ctx.session.user,
        });

        return await inviteService.approveInvite({
          inviteId: input.inviteId,
          organizationId: input.organizationId,
        });
      } catch (error) {
        if (
          error instanceof InviteNotFoundError ||
          error instanceof OrganizationNotFoundError
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        if (error instanceof LimitExceededError) {
          void getApp()
            .usageLimits.notifyResourceLimitReached({
              organizationId: input.organizationId,
              limitType: error.limitType,
              current: error.current,
              max: error.max,
            })
            .catch(captureException);

          throw new TRPCError({
            code: "FORBIDDEN",
            message: error.message,
          });
        }
        throw error;
      }
    }),
  acceptInvite: protectedProcedure
    .input(
      z.object({
        inviteCode: z.string(),
      }),
    )
    .use(skipPermissionCheck)
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const session = ctx.session;
      const invite = await prisma.organizationInvite.findUnique({
        where: { inviteCode: input.inviteCode },
        include: { organization: true },
      });

      if (
        !invite ||
        (invite.expiration !== null && invite.expiration < new Date())
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite not found or has expired",
        });
      }

      if (!session || !session.user || !session.user.email) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be signed in to accept the invite",
        });
      }

      if (invite.status === "ACCEPTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invite was already accepted",
        });
      }

      if (session.user.email !== invite.email) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `The invite was sent to ${invite.email}, but you are signed in as ${session.user.email}`,
        });
      }

      await prisma.$transaction(async (prisma) => {
        // Create org membership; skip if it already exists
        await prisma.organizationUser.createMany({
          data: [
            {
              userId: session.user.id,
              organizationId: invite.organizationId,
              role: invite.role,
            },
          ],
          skipDuplicates: true,
        });

        // Create ORGANIZATION-scoped RoleBinding (skip EXTERNAL — they get access via team/project bindings)
        if (invite.role !== OrganizationUserRole.EXTERNAL) {
          await prisma.roleBinding.deleteMany({
            where: {
              organizationId: invite.organizationId,
              userId: session.user.id,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: invite.organizationId,
            },
          });
          await prisma.roleBinding.create({
            data: {
              id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
              organizationId: invite.organizationId,
              userId: session.user.id,
              role: invite.role as unknown as TeamUserRole,
              scopeType: RoleBindingScopeType.ORGANIZATION,
              scopeId: invite.organizationId,
            },
          });
        }

        // Use teamAssignments if available (new format), otherwise fall back to legacy teamIds
        let teamMembershipData: Array<{
          userId: string;
          teamId: string;
          role: TeamUserRole;
          customRoleId?: string;
        }> = [];

        if (invite.teamAssignments && Array.isArray(invite.teamAssignments)) {
          // New format: use per-team roles from teamAssignments
          const assignments = invite.teamAssignments as Array<{
            teamId: string;
            role: TeamUserRole;
            customRoleId?: string;
          }>;
          teamMembershipData = assignments.map((assignment) => ({
            userId: session.user.id,
            teamId: assignment.teamId,
            role: assignment.role,
            customRoleId: assignment.customRoleId,
          }));
        } else {
          // Legacy format: use organization role mapping
          const dedupedTeamIds = Array.from(
            new Set(
              invite.teamIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          );

          teamMembershipData = dedupedTeamIds.map((teamId) => ({
            userId: session.user.id,
            teamId,
            role: ORGANIZATION_TO_TEAM_ROLE_MAP[invite.role],
          }));
        }

        if (teamMembershipData.length > 0) {
          // Handle custom roles separately since createMany doesn't support assignedRoleId
          const builtInRoles = teamMembershipData.filter(
            (data) => data.role !== TeamUserRole.CUSTOM,
          );
          const customRoles = teamMembershipData.filter(
            (data) => data.role === TeamUserRole.CUSTOM && data.customRoleId,
          );

          // Create team memberships with built-in roles
          if (builtInRoles.length > 0) {
            await prisma.teamUser.createMany({
              data: builtInRoles.map(
                ({ customRoleId: _customRoleId, ...data }) => data,
              ),
              skipDuplicates: true,
            });
          }

          // Create team memberships with custom roles (requires individual creates for assignedRoleId)
          for (const customRole of customRoles) {
            try {
              await prisma.teamUser.create({
                data: {
                  userId: customRole.userId,
                  teamId: customRole.teamId,
                  role: TeamUserRole.CUSTOM,
                  assignedRoleId: customRole.customRoleId!,
                },
              });
            } catch (error: unknown) {
              // Ignore unique constraint violations (concurrent inserts)
              if (
                error instanceof PrismaClientKnownRequestError &&
                error.code === "P2002"
              ) {
                // Swallow the error - record already exists
                continue;
              }
              // Rethrow other errors
              throw error;
            }
          }

          // Create TEAM-scoped RoleBindings for all team assignments
          for (const member of teamMembershipData) {
            await prisma.roleBinding.deleteMany({
              where: {
                organizationId: invite.organizationId,
                userId: member.userId,
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: member.teamId,
              },
            });
            await prisma.roleBinding.create({
              data: {
                id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
                organizationId: invite.organizationId,
                userId: member.userId,
                role: member.role,
                customRoleId: member.customRoleId ?? null,
                scopeType: RoleBindingScopeType.TEAM,
                scopeId: member.teamId,
              },
            });
          }
        }

        await prisma.organizationInvite.update({
          where: { id: invite.id, organizationId: invite.organizationId },
          data: { status: "ACCEPTED" },
        });
      });

      const inviteService = InviteService.create(prisma);
      const projectSlug = await inviteService.findLandingProjectSlug(invite);

      return { success: true, invite, project: projectSlug ? { slug: projectSlug } : null };
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
