import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireTeamMemberInvitedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/../ee/billing/nurturing/hooks/inviteAcceptance";
import {
  type Organization,
  type OrganizationInvite,
  OrganizationUserRole,
  type PrismaClient,
} from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import {
  identityEmail,
  joinRequestsService,
} from "~/server/app-layer/identity/runtime";
import type { Session } from "~/server/auth";
import {
  INVITE_ALREADY_ACCEPTED_MESSAGE,
  INVITE_NOT_READY_MESSAGE,
  InviteExpiredError,
  InviteNotFoundError,
  InviteWrongAccountError,
  OrganizationNotFoundError,
} from "~/server/invites/errors";
import {
  InviteService,
  maskInvitedAddress,
  matchInviteToAcceptor,
  resolveInviteDisplayStatus,
} from "~/server/invites/invite.service";
import { buildInviteAcceptUrl } from "~/server/invites/invite-link";
import { assertInviteSendAllowed } from "~/server/invites/invite-send-throttle";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { trackServerEvent } from "~/server/posthog";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import {
  assertEnterprisePlan,
  ENTERPRISE_FEATURE_ERRORS,
  isCustomRole,
} from "../enterprise";
import { teamRoleInputSchema } from "./schemas/team-role";

interface CreatedInviteBatch {
  organization: { members: readonly unknown[] };
  invites: readonly {
    invite: {
      id: string;
      email: string;
      organizationId: string;
      role: OrganizationUserRole;
    };
  }[];
}

async function recordCreatedInvites({
  prisma,
  userId,
  created,
}: {
  prisma: PrismaClient;
  userId: string;
  created: CreatedInviteBatch;
}): Promise<void> {
  if (created.invites.length === 0) return;

  await Promise.all(
    created.invites.map(async (record) => {
      const invited = await prisma.user.findFirst({
        where: { email: record.invite.email },
        select: { id: true },
      });
      if (!invited) return;
      try {
        await joinRequestsService().resolveByInvitation({
          userId: invited.id,
          organizationId: record.invite.organizationId,
          inviteId: record.invite.id,
        });
      } catch (error) {
        captureException(toError(error), {
          tags: { organizationId: record.invite.organizationId },
        });
      }
    }),
  );

  trackServerEvent({
    userId,
    event: "team_member_invited",
    properties: { inviteCount: created.invites.length },
  });
  const memberCount =
    created.organization.members.length + created.invites.length;
  for (const record of created.invites) {
    fireTeamMemberInvitedNurturing({
      userId,
      teamMemberCount: memberCount,
      role: record.invite.role,
    });
  }
}

type InviteWithOrganization = OrganizationInvite & {
  organization: Organization;
};

function assertInviteExists(
  invite: InviteWithOrganization | null,
): asserts invite is InviteWithOrganization {
  if (!invite || invite.status === "REVOKED") {
    throw new InviteNotFoundError("Invitation not found");
  }
}

function requireSessionEmail(session: Session | null): string {
  if (session?.user.email) return session.user.email;

  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "You must be signed in to accept the invite",
  });
}

function assertInvitePending(invite: InviteWithOrganization): void {
  if (invite.status === "ACCEPTED") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: INVITE_ALREADY_ACCEPTED_MESSAGE,
    });
  }
  if (resolveInviteDisplayStatus(invite) === "EXPIRED") {
    throw new InviteExpiredError();
  }
  if (invite.status !== "PENDING") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: INVITE_NOT_READY_MESSAGE,
    });
  }
}

async function matchInviteAcceptor({
  invite,
  session,
  sessionEmail,
}: {
  invite: InviteWithOrganization;
  session: Session;
  sessionEmail: string;
}): Promise<string | null> {
  const { matches, viaIdentifierId } = matchInviteToAcceptor({
    inviteEmail: invite.email,
    sessionEmail,
    matchable: await identityEmail().verifiedEmailsOf({
      userId: session.user.id,
    }),
  });
  if (!matches) {
    throw new InviteWrongAccountError(maskInvitedAddress(invite.email));
  }
  return viaIdentifierId;
}

async function finishInviteAcceptance({
  prisma,
  session,
  invite,
}: {
  prisma: PrismaClient;
  session: Session;
  invite: InviteWithOrganization;
}): Promise<void> {
  try {
    await joinRequestsService().withdrawOnInvitationAccepted({
      userId: session.user.id,
      organizationId: invite.organizationId,
    });
  } catch (error) {
    captureException(toError(error), {
      tags: { organizationId: invite.organizationId },
    });
  }

  try {
    const personalWorkspaceService = new PersonalWorkspaceService(prisma);
    await personalWorkspaceService.ensure({
      userId: session.user.id,
      organizationId: invite.organizationId,
      displayName: session.user.name,
      displayEmail: session.user.email,
    });
  } catch (error) {
    captureException(toError(error), {
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
}

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
    .permission("organization:manage")
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

      const inviteService = InviteService.create(ctx.prisma);

      let created: Awaited<ReturnType<typeof inviteService.createInvites>>;
      try {
        // Lenient validation keeps this procedure's historical form
        // behavior: invalid teams and custom roles drop the assignment or
        // the invite quietly instead of refusing the batch.
        created = await inviteService.createInvites({
          organizationId: input.organizationId,
          invites: input.invites,
          user: ctx.session.user,
          validation: "lenient",
        });
      } catch (error) {
        if (error instanceof OrganizationNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Organization not found",
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

      await recordCreatedInvites({
        prisma: ctx.prisma,
        userId: ctx.session.user.id,
        created,
      });

      return created.invites;
    }),

  deleteInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      const inviteService = InviteService.create(ctx.prisma);
      await inviteService.revokeInvite({
        organizationId: input.organizationId,
        inviteId: input.inviteId,
      });
    }),

  resendInvite: protectedProcedure
    .input(z.object({ inviteId: z.string(), organizationId: z.string() }))
    .permission("organization:manage")
    .mutation(async ({ input, ctx }) => {
      // Throttled per INVITATION, because the thing being protected is the
      // recipient's inbox rather than this server: an admin with three
      // invitations out may resend all three, and none of the three gets
      // mailed repeatedly. Checked before the resend so a refused attempt
      // leaves the live code alone — rotation is the old link's revocation,
      // and a throttled click must not quietly break the link already sent.
      await assertInviteSendAllowed({ inviteId: input.inviteId });

      const inviteService = InviteService.create(ctx.prisma);
      const { invite, emailNotSent } = await inviteService.resendInvite({
        organizationId: input.organizationId,
        inviteId: input.inviteId,
      });
      return {
        invite,
        emailNotSent,
        inviteUrl: buildInviteAcceptUrl(invite.inviteCode),
      };
    }),

  getOrganizationPendingInvites: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
      }),
    )
    // Pending invites expose admin intent (who is being added, with which
    // role and teams), so this remains an organization-management surface.
    .permission("organization:manage")
    .query(async ({ input, ctx }) => {
      const inviteService = InviteService.create(ctx.prisma);
      return inviteService.listInvites({
        organizationId: input.organizationId,
      });
    }),

  acceptInvite: protectedProcedure
    .input(
      z.object({
        inviteCode: z.string(),
      }),
    )
    .noPermission({
      reason:
        "runs before or across organization membership: creating an organization, listing the caller's own, accepting an invite",
    })
    .mutation(async ({ input, ctx }) => {
      const prisma = ctx.prisma;
      const session = ctx.session;
      const invite = await prisma.organizationInvite.findUnique({
        where: { inviteCode: input.inviteCode },
        include: { organization: true },
      });
      assertInviteExists(invite);
      const sessionEmail = requireSessionEmail(session);
      assertInvitePending(invite);

      // Identifier-aware acceptance (D11): an invitation targets an address,
      // and ANY of the signed-in user's VERIFIED identifiers holding that
      // address vouches for them — password, Google, or the org's SSO. The
      // person invited by email who signed in with their Google account is
      // no longer a support ticket. A user not yet on identifiers answers
      // `null` and keeps the legacy session-email comparison byte-for-byte.
      const viaIdentifierId = await matchInviteAcceptor({
        invite,
        session,
        sessionEmail,
      });

      // No transaction: the invite's grants are ledger commands, so the
      // membership row has to be committed before they are emitted, and the
      // invite is only marked ACCEPTED once everything before it has landed
      // (a still-PENDING invite is one still to apply).
      await InviteService.create(prisma).applyInvite({
        userId: session.user.id,
        invite,
        viaIdentifierId,
      });

      await finishInviteAcceptance({ prisma, session, invite });

      const inviteService = InviteService.create(prisma);
      const projectSlug = await inviteService.findLandingProjectSlug(invite);

      return {
        success: true,
        invite,
        project: projectSlug ? { slug: projectSlug } : null,
      };
    }),
});
