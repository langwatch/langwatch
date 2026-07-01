import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireTeamMemberInvitedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/../ee/billing/nurturing/hooks/inviteAcceptance";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { trackServerEvent } from "~/server/posthog";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  DuplicateInviteError,
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  InviteNotFoundError,
  OrganizationNotFoundError,
} from "../../invites/errors";
import {
  InviteService,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
} from "../../invites/invite.service";
import { LimitExceededError } from "../../license-enforcement/errors";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  isCustomRole,
} from "../enterprise";
import { checkOrganizationPermission, skipPermissionCheck } from "../rbac";
import { teamRoleInputSchema } from "./schemas/teamRole";

export const inviteRouter = createTRPCRouter({
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
              .map((t) => t.customRoleId)
              .filter((id): id is string => !!id);
            if (customRoleIds.length > 0) {
              const validCustomRoles = await prisma.customRole.findMany({
                where: {
                  id: { in: customRoleIds },
                  organizationId: input.organizationId,
                  kind: "custom",
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
    // Tightened from organization:view to manage — pending invites
    // expose admin intent (who's being added, with what role / to
    // which teams). MEMBER reading this is a leak. Both TS callers
    // (settings/members, SubscriptionPage) are admin-only surfaces.
    .use(checkOrganizationPermission("organization:manage"))
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
                      hasCustom && t.customRoleId ? t.customRoleId : undefined,
                  };
                });

              // Validate custom role IDs belong to this organization and are user-assignable
              const customRoleIds = teamAssignments
                .map((t) => t.customRoleId)
                .filter((id): id is string => !!id);
              if (customRoleIds.length > 0) {
                const validCustomRoles = await prisma.customRole.findMany({
                  where: {
                    id: { in: customRoleIds },
                    organizationId: input.organizationId,
                    kind: "custom",
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

      if (!session?.user?.email) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You must be signed in to accept the invite",
        });
      }

      if (invite.status === "ACCEPTED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: INVITE_ALREADY_ACCEPTED_MESSAGE,
        });
      }

      if (invite.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: INVITE_NOT_READY_MESSAGE,
        });
      }

      // Case-insensitive email comparison: BetterAuth lowercases emails
      // during signup/signin (see `findUserByEmail` in
      // node_modules/better-auth/dist/db/internal-adapter.mjs) so
      // `session.user.email` is always lowercase, but `invite.email`
      // preserves the admin's original casing. A strict `!==` would
      // reject an "Alice@Acme.com" invite for an "alice@acme.com" user.
      // The old NextAuth flow worked accidentally because it didn't
      // lowercase emails either — this is now a real mismatch post-migration.
      if (
        session.user.email.toLowerCase() !== invite.email.trim().toLowerCase()
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `The invite was sent to ${invite.email}, but you are signed in as ${session.user.email}`,
        });
      }

      await prisma.$transaction(async (tx) => {
        const txInviteService = InviteService.create(tx);
        await txInviteService.applyInvite({
          userId: session.user.id,
          invite,
        });
      });

      // Provision the user's Personal Workspace (Team.isPersonal +
      // Project.isPersonal) for this org. Idempotent — safe if a prior
      // invite already triggered it. Runs outside the invite tx so an
      // unexpected failure here doesn't roll the membership back; the
      // next login will retry via the lazy backfill in
      // `user.personalContext`.
      try {
        const personalWorkspaceService = new PersonalWorkspaceService(prisma);
        await personalWorkspaceService.ensure({
          userId: session.user.id,
          organizationId: invite.organizationId,
          displayName: session.user.name,
          displayEmail: session.user.email,
        });
      } catch (err) {
        // Non-fatal — capture and continue. Lazy backfill will recover
        // on the user's next session resolution. PostHog signal lets
        // operators catch systemic provisioning regressions (bad
        // migration, schema drift, Prisma constraint violation) before
        // users start complaining about missing personal workspaces.
        captureException(toError(err), {
          extra: {
            origin: "governance.acceptInvite",
            userId: session.user.id,
            organizationId: invite.organizationId,
          },
        });
      }

      void getApp()
        .notifications.sendSlackSignupEvent({
          userName: session.user.name,
          userEmail: session.user.email,
          organizationName: invite.organization.name,
        })
        .catch(captureException);

      fireInviteAcceptedNurturingCalls({
        userId: session.user.id,
        email: session.user.email,
        name: session.user.name,
        organizationId: invite.organization.id,
        organizationName: invite.organization.name,
      });

      const inviteService = InviteService.create(prisma);
      const projectSlug = await inviteService.findLandingProjectSlug(invite);

      return {
        success: true,
        invite,
        project: projectSlug ? { slug: projectSlug } : null,
      };
    }),
});
