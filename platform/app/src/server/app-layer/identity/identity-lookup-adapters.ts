import type { LinkProposalDirectoryPort } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { InviteService } from "~/server/invites/invite.service";
import { betterAuthInstance } from "./better-auth-instance.adapter";
import type {
  OperatorInvitationPort,
  OperatorSessionPort,
} from "./identity-lookup.service";
import type { SessionRevocationService } from "./session-revocation.service";

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
  constructor(private readonly sessions: SessionRevocationService) {}

  async endAllForUser({ userId }: { userId: string }): Promise<void> {
    await this.sessions.revokeAll({ userId });
  }

  async endForIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }): Promise<void> {
    await this.sessions.revokeForIdentifier({ userId, identifierId });
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
  constructor(private readonly prisma: PrismaClient) {}

  async linkProviderAccount({
    userId,
    connectionId,
    provider,
    subject,
  }: {
    userId: string;
    connectionId: string | null;
    provider: string;
    subject: string;
    normalizedEmail: string;
  }): Promise<void> {
    const issuer = await this.issuerFor({ connectionId, provider });
    const betterAuth = await betterAuthInstance();
    await betterAuth.$context.then((context) =>
      context.internalAdapter.createAccount({
        userId,
        providerId: provider,
        issuer,
        accountId: subject,
      }),
    );
  }

  /**
   * WHO asserted this subject — the other half of better-auth 1.7's account
   * key, which it looks up as `(issuer, accountId)`.
   *
   * A proposal that names a connection takes that connection's own issuer,
   * because the identity provider behind it is literally the party that
   * asserted the subject. Everything else follows the convention the
   * `account_issuer` migration established when it backfilled this column,
   * so a row written here and a row backfilled then are keyed the same way —
   * which is the whole point of the column.
   */
  private async issuerFor({
    connectionId,
    provider,
  }: {
    connectionId: string | null;
    provider: string;
  }): Promise<string> {
    if (connectionId !== null) {
      const connection = await this.prisma.ssoConnection.findUnique({
        where: { id: connectionId },
        select: { idpMetadata: true },
      });
      const issuer = (connection?.idpMetadata as { issuer?: string } | null)
        ?.issuer;
      if (issuer) return issuer;
    }
    if (provider === "credential") return "local:credential";
    if (provider === "google") return "https://accounts.google.com";
    return `local:oauth:${provider}`;
  }
}
