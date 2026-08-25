import type { LinkProposalDirectoryPort } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { auth as betterAuth } from "~/server/better-auth";
import {
  revokeAllSessionsForUser,
  revokeSessionsForIdentifier,
} from "~/server/better-auth/revokeSessions";
import { InviteService } from "~/server/invites/invite.service";
import type {
  OperatorInvitationPort,
  OperatorSessionPort,
} from "./identity-lookup.service";

const logger = createLogger("langwatch:identity:lookup");

/**
 * Ending sessions, as the operator lookup needs it.
 *
 * Both verbs already existed; neither is reimplemented here. The per-method
 * one is the newer half (D06's `Session.identifierId` is what makes it
 * possible), and it is the reason this port has two methods rather than a
 * nullable argument: "sign this device out" and "sign this person out
 * everywhere" are two decisions an operator makes, not one with a flag.
 */
export class BetterAuthOperatorSessions implements OperatorSessionPort {
  constructor(private readonly prisma: PrismaClient) {}

  async endAllForUser({ userId }: { userId: string }): Promise<void> {
    await revokeAllSessionsForUser({ prisma: this.prisma, userId });
  }

  async endForIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<void> {
    await revokeSessionsForIdentifier({
      prisma: this.prisma,
      userId,
      identifierId,
    });
  }
}

/**
 * Invitations, as the operator lookup needs them.
 *
 * Straight through to `InviteService`. The organization's own admins reach
 * the same two verbs from their members page, and an operator reaching them
 * from here must do exactly what they do — including the send throttle,
 * which is a property of the invitation and not of who is asking.
 */
export class InviteServiceOperatorInvitations
  implements OperatorInvitationPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async resend({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ expiresAtMs: number | null }> {
    const { invite, emailNotSent } = await InviteService.create(
      this.prisma,
    ).resendInvite({ organizationId, inviteId });
    if (emailNotSent) {
      // The resend still happened — the old code stopped working the moment
      // the new one was written — so this is a warning, not a failure.
      logger.warn(
        { inviteId, organizationId },
        "an operator resent an invitation and the mail did not go out",
      );
    }
    return { expiresAtMs: invite.expiration?.getTime() ?? null };
  }

  async extend({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ expiresAtMs: number | null }> {
    const { invite } = await InviteService.create(this.prisma).extendInvite({
      organizationId,
      inviteId,
    });
    return { expiresAtMs: invite.expiration?.getTime() ?? null };
  }
}

/**
 * How a confirmed proposal becomes a sign-in method: better-auth creates the
 * provider account, which fires the account ceremony, which attaches the
 * identifier through the pipeline. The ORDINARY ceremony — this adapter
 * writes no `Account` row and attaches no identifier, because a second way
 * to claim a row is the risk the proposal exists to remove.
 */
export class BetterAuthLinkProposalDirectory
  implements LinkProposalDirectoryPort
{
  async linkProviderAccount({
    userId,
    provider,
    subject,
  }: {
    userId: string;
    connectionId: string | null;
    provider: string;
    subject: string;
    normalizedEmail: string;
  }): Promise<void> {
    await betterAuth.$context.then((context) =>
      context.internalAdapter.createAccount({
        userId,
        providerId: provider,
        accountId: subject,
      }),
    );
  }
}
