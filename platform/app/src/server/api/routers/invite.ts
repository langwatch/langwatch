import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireTeamMemberInvitedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { fireInviteAcceptedNurturingCalls } from "~/../ee/billing/nurturing/hooks/inviteAcceptance";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { identityEmail, joinRequestsService } from "~/server/app-layer/identity/runtime";
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
import { assertEnterprisePlan, ENTERPRISE_FEATURE_ERRORS, isCustomRole } from "../enterprise";
import { teamRoleInputSchema } from "./schemas/team-role";

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
        (invite.teams ?? []).some((t) => typeof t.role === "string" && isCustomRole(t.role)),
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

      if (created.invites.length > 0) {
        // D11 x D12, invitation -> request: a formal invitation sent to
        // somebody with an open request ANSWERS it. The invitation carries
        // the role and the teams, which is the flow that owns them, so the
        // request resolves as approved-by-invitation rather than staying
        // open beside it. Silent when nothing is open, and never fatal — the
        // invitation is the durable outcome here.
        await Promise.all(
          created.invites.map(async (record) => {
            const invited = await ctx.prisma.user.findFirst({
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
          userId: ctx.session.user.id,
          event: "team_member_invited",
          properties: { inviteCount: created.invites.length },
        });

        const memberCount = created.organization.members.length + created.invites.length;
        for (const record of created.invites) {
          fireTeamMemberInvitedNurturing({
            userId: ctx.session.user.id,
            teamMemberCount: memberCount,
            role: record.invite.role,
          });
        }
      }

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

      // A revoked invitation reads exactly like a missing one on purpose:
      // the journey ends quietly, revealing nothing about the organization
      // or the inviter. Expired is different — it is recoverable (the
      // inviter resends in one click), so it gets its own named refusal.
      if (!invite || invite.status === "REVOKED") {
        throw new InviteNotFoundError("Invitation not found");
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

      if (resolveInviteDisplayStatus(invite) === "EXPIRED") {
        throw new InviteExpiredError();
      }

      if (invite.status !== "PENDING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: INVITE_NOT_READY_MESSAGE,
        });
      }

      // Identifier-aware acceptance (D11): an invitation targets an address,
      // and ANY of the signed-in user's VERIFIED identifiers holding that
      // address vouches for them — password, Google, or the org's SSO. The
      // person invited by email who signed in with their Google account is
      // no longer a support ticket. A user not yet on identifiers answers
      // `null` and keeps the legacy session-email comparison byte-for-byte.
      const { matches: inviteEmailMatches, viaIdentifierId } = matchInviteToAcceptor({
        inviteEmail: invite.email,
        sessionEmail: session.user.email,
        matchable: await identityEmail().verifiedEmailsOf({
          userId: session.user.id,
        }),
      });
      // Signed in as somebody else is a wrong turn, not a refusal: the screen
      // names which account is wanted and offers the way back. The hint is
      // masked because an invite code is a bearer token — the landing already
      // declines to name the invited address, and a mismatch is not a hole to
      // read it through.
      if (!inviteEmailMatches) {
        throw new InviteWrongAccountError(maskInvitedAddress(invite.email));
      }

      // No transaction: the invite's grants are ledger commands, so the
      // membership row has to be committed before they are emitted, and the
      // invite is only marked ACCEPTED once everything before it has landed
      // (a still-PENDING invite is one still to apply).
      await InviteService.create(prisma).applyInvite({
        userId: session.user.id,
        invite,
        viaIdentifierId,
      });

      // D11 x D12, acceptance -> request: accepting an invitation withdraws
      // the same person's open request for this organization, so the
      // membership lands exactly once and the admins' panel empties itself.
      // Never fatal — the membership is the durable outcome, and a request
      // left open is answered by the next approval or by the expiry.
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
