/**
 * An invitation after it exists: resending it, asking for a fresh one, and the
 * payment-pending invites a checkout creates and later approves.
 */
import { isAccountManagedPlan } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import {
  InviteNotFoundError,
  OrganizationNotFoundError,
  type OrganizationInvite,
} from "@langwatch/organization-contract";
import { nanoid } from "nanoid";
import type { OrganizationInviteRepository } from "../repositories/organization-invite.repository.ts";
import type { OrganizationInviteMail } from "../app/organization.members.ts";
import { resolveInviteDisplayStatus } from "../rules/invite-display-status.rules.ts";
import {
  INVITE_EXPIRATION_MS,
  type CreatePaymentPendingInviteInput,
  type InviteServiceDependencies,
} from "../rules/invite-contracts.rules.ts";
import { InviteCreationService } from "./invite-creation.service.ts";
import { nowInstant, toDate } from "@langwatch/time";

const logger = createLogger("langwatch:invites:lifecycle");

export class InviteLifecycleService {
  static create(deps: InviteServiceDependencies): InviteLifecycleService {
    return new InviteLifecycleService(deps);
  }

  private readonly creation: InviteCreationService;

  private constructor(private readonly deps: InviteServiceDependencies) {
    this.creation = InviteCreationService.create(deps);
  }

  private get invites(): OrganizationInviteRepository {
    return this.deps.invites;
  }

  private get mailer(): OrganizationInviteMail | undefined {
    return this.deps.mail;
  }

  /**
   * One-click resend (D11): a fresh invite code and a fresh 14-day expiry on the
   * same row, and a new email out. Rotating the code IS the old link's
   * revocation — a leaked stale link matches no row afterwards.
   */
  async resendInvite({
    organizationId,
    inviteId,
  }: {
    organizationId: string;
    inviteId: string;
  }): Promise<{ invite: OrganizationInvite; emailNotSent: boolean }> {
    const existing = await this.invites.tryFindInviteWithOrganization({ inviteId, organizationId });
    if (existing?.status !== "PENDING") {
      throw new InviteNotFoundError("Invitation not found");
    }

    if (!existing.organization) {
      throw new OrganizationNotFoundError();
    }

    const freshCode = nanoid();
    const freshExpiration = toDate(nowInstant().add({ milliseconds: INVITE_EXPIRATION_MS }));
    const claimed = await this.invites.rotateInviteCode({
      inviteId: existing.id,
      organizationId,
      expectedInviteCode: existing.inviteCode,
      inviteCode: freshCode,
      expiration: freshExpiration,
    });
    if (claimed === 0) {
      throw new InviteNotFoundError("Invitation not found");
    }

    // Same contract as approval: an email failure never reverts the resend —
    // the fresh link exists and is shown as the fallback.
    const { emailNotSent } = await this.creation.sendInviteEmail({
      email: existing.email,
      organization: existing.organization,
      inviteCode: freshCode,
    });

    const { organization: _organization, ...inviteRow } = existing;

    return {
      invite: {
        ...inviteRow,
        inviteCode: freshCode,
        expiration: freshExpiration,
      },
      emailNotSent,
    };
  }

  /**
   * The invitee, holding an expired link, asks for a fresh one (D11).
   */
  async requestFreshInvite({
    inviteCode,
    membersSettingsUrl,
  }: {
    inviteCode: string;
    membersSettingsUrl: string;
  }): Promise<{ notifiedAdmins: number }> {
    if (!this.mailer) {
      return { notifiedAdmins: 0 };
    }

    const existing = await this.invites.tryFindInviteByCodeWithOrganization({ inviteCode });
    if (existing?.status !== "PENDING" || !existing.organization) {
      throw new InviteNotFoundError("Invitation not found");
    }

    if (resolveInviteDisplayStatus(existing) !== "EXPIRED") {
      throw new InviteNotFoundError("Invitation not found");
    }

    // The same counter the admin's resend spends, keyed by the invitation's
    // stable id rather than its code — the code rotates on every resend, so
    // keying on it would hand out a fresh allowance with each new link.
    // Spent here, after the code resolves, so the two routes to one inbox
    // cannot be alternated to double the mail.
    await this.deps.throttle.assertInviteSendAllowed({ inviteId: existing.id });

    const adminEmails = await this.invites.findAdminEmails({
      organizationId: existing.organizationId,
    });
    const mailer = this.mailer;
    if (!mailer) {
      return { notifiedAdmins: 0 };
    }

    const seats = await this.trySeatCensus({ organizationId: existing.organizationId });

    // One failing address must not silence the rest: an organization whose
    // first admin has a bouncing address still has the others to ask.
    const results = await Promise.allSettled(
      adminEmails.map((adminEmail) =>
        mailer.sendInviteReRequest({
          adminEmail,
          organizationName: existing.organization?.name ?? "",
          invitedEmail: existing.email,
          membersSettingsUrl,
          ...seats,
        }),
      ),
    );

    return {
      notifiedAdmins: results.filter((r) => r.status === "fulfilled").length,
    };
  }

  /**
   * Seats held against the seats the plan covers, where that is a fact.
   *
   * Nothing is returned for an organization on enterprise or negotiated terms:
   * its ceiling was agreed rather than bought, so the number on the public
   * page is not its number and a mail that quoted it would be wrong in a way
   * the administrator can see. A census that cannot be read returns nothing
   * too — a seat line is not worth failing a re-request over.
   */
  private async trySeatCensus({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ seats?: { used: number; ceiling: number } }> {
    try {
      const plan = await this.deps.plans.getActivePlan({ organizationId });
      if (isAccountManagedPlan(plan) || plan.maxMembers <= 0) return {};

      return {
        seats: {
          used: await this.deps.seats.getMemberCount(organizationId),
          ceiling: plan.maxMembers,
        },
      };
    } catch (error) {
      logger.warn({ error }, "Could not read the seat census for an invitation re-request");

      return {};
    }
  }

  /**
   * Creates an invite with PAYMENT_PENDING status (checkout flow).
   * No expiration, no email — waits for Stripe checkout success.
   */
  async createPaymentPendingInvite(
    input: CreatePaymentPendingInviteInput,
  ): Promise<OrganizationInvite> {
    this.creation.assertAssignmentsWithinInvitedSeat(input);
    const inviteCode = nanoid();

    return this.invites.createPaymentPendingInvite({
      email: input.email,
      inviteCode,
      expiration: null,
      organizationId: input.organizationId,
      teamIds: input.teamIds,
      ...(input.teamAssignments && input.teamAssignments.length > 0
        ? { teamAssignments: input.teamAssignments }
        : {}),
      role: input.role,
      subscriptionId: input.subscriptionId,
    });
  }

  /**
   * Turns every PAYMENT_PENDING invite on a subscription into a live PENDING invite once
   * checkout succeeded, giving each one an expiry and sending its invitation email, so the
   * seats the customer paid for reach the people they were bought for.
   */
  async approvePaymentPendingInvites({
    subscriptionId,
    organizationId,
  }: {
    subscriptionId: string;
    organizationId: string;
  }): Promise<OrganizationInvite[]> {
    const invites = await this.invites.findPaymentPendingInvites({
      subscriptionId,
      organizationId,
    });

    const approved: OrganizationInvite[] = [];

    for (const invite of invites) {
      const updatedInvite = await this.invites.approvePaymentPendingInvite({
        inviteId: invite.id,
        organizationId,
        expiration: toDate(nowInstant().add({ milliseconds: INVITE_EXPIRATION_MS })),
      });

      if (invite.organization) {
        await this.creation.sendInviteEmail({
          email: invite.email,
          organization: invite.organization,
          inviteCode: invite.inviteCode,
        });
      }

      approved.push(updatedInvite);
    }

    return approved;
  }
}
