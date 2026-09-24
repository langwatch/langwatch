import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { JoinRequestNotificationMail } from "../app/identity.members.ts";
import type { JoinRequestAudience } from "../repositories/join-request-audience.repository.ts";
import type { PrismaJoinRequestNotificationContextRepository } from "../repositories/prisma/prisma.join-request-notification-context.repository.ts";
import type { JoinRequestNotifier } from "../rules/join-requests-contract.rules.ts";

const logger = createLogger("langwatch:identity:join-request-adapters");

/** The organization's plan, read only for the fields the seat census needs. */
export type JoinRequestNotifierPlans = {
  getActivePlan(input: {
    organizationId: string;
  }): Promise<{ maxMembers: number; planSource?: string; overrideAddingLimitations?: boolean }>;
};

/** How many full members an organization holds, for the same seat census as the plan check. */
export type JoinRequestNotifierMemberships = {
  getMemberCount(organizationId: string): Promise<number>;
};

/**
 * Who is told, and how. Every fan-out is `Promise.allSettled`, for the reason D11's re-request mail
 * gives: one bouncing admin address must not silence the rest. A mail that cannot be sent is logged
 * and the request stands — the durable fact is the request, not the notification.
 */
export class EmailJoinRequestNotifierAdapter implements JoinRequestNotifier {
  static create(options: {
    audience: JoinRequestAudience;
    context: PrismaJoinRequestNotificationContextRepository;
    mail: JoinRequestNotificationMail;
    /** This deployment's public origin, for a lapsed requester's personal project link. */
    baseHost: string;
    /** Read for the seat census a domain-auto-join notice carries. Absent omits it. */
    plans?: JoinRequestNotifierPlans;
    memberships?: JoinRequestNotifierMemberships;
  }): EmailJoinRequestNotifierAdapter {
    return new EmailJoinRequestNotifierAdapter({
      audience: options.audience,
      context: options.context,
      mail: options.mail,
      baseHost: options.baseHost,
      plans: options.plans,
      memberships: options.memberships,
    });
  }

  private readonly audience: JoinRequestAudience;
  private readonly context: PrismaJoinRequestNotificationContextRepository;
  private readonly mail: JoinRequestNotificationMail;
  private readonly baseHost: string;
  private readonly plans: JoinRequestNotifierPlans | undefined;
  private readonly memberships: JoinRequestNotifierMemberships | undefined;

  private constructor({
    audience,
    context,
    mail,
    baseHost,
    plans,
    memberships,
  }: {
    audience: JoinRequestAudience;
    context: PrismaJoinRequestNotificationContextRepository;
    mail: JoinRequestNotificationMail;
    baseHost: string;
    plans: JoinRequestNotifierPlans | undefined;
    memberships: JoinRequestNotifierMemberships | undefined;
  }) {
    this.audience = audience;
    this.context = context;
    this.mail = mail;
    this.baseHost = baseHost;
    this.plans = plans;
    this.memberships = memberships;
  }

  async requestArrived({
    joinRequestId,
    organizationId,
    requesterUserId,
    domain,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void> {
    const [organizationName, requesterName, admins, approvedFromDomainCount] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.adminEmails({ organizationId }),
      this.approvedFromDomainCount({ organizationId, domain }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "requestArrived",
      sends: admins.map((adminEmail) =>
        this.mail.sendRequestArrived({
          adminEmail,
          organizationName,
          requesterName,
          domain,
          approvedFromDomainCount,
        }),
      ),
    });
  }

  async requestStillWaiting({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<void> {
    const requesterUserId = await this.audience
      .getRequesterId({ joinRequestId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "join_request_not_found")
          return undefined;
        throw error;
      });
    if (!requesterUserId) return;
    const [organizationName, requesterName, admins] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.adminEmails({ organizationId }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "requestStillWaiting",
      sends: admins.map((adminEmail) =>
        this.mail.sendRequestStillWaiting({ adminEmail, organizationName, requesterName }),
      ),
    });
  }

  async requestApproved({
    joinRequestId,
    organizationId,
    requesterUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void> {
    const [organizationName, requesterEmail, intent] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
      this.organizationIntent({ organizationId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestApproved",
      sends: [this.mail.sendRequestApproved({ requesterEmail, organizationName, ...intent })],
    });
  }

  async requestRejected({
    joinRequestId,
    organizationId,
    requesterUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void> {
    const [organizationName, requesterEmail] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestRejected",
      sends: [this.mail.sendRequestRejected({ requesterEmail, organizationName })],
    });
  }

  async requestExpired({
    joinRequestId,
    organizationId,
    requesterUserId,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void> {
    const [organizationName, requesterEmail, personalProjectUrl] = await Promise.all([
      this.organizationName({ organizationId }),
      this.emailOf({ userId: requesterUserId }),
      this.tryPersonalProjectUrl({ userId: requesterUserId }),
    ]);
    if (!requesterEmail) return;
    await this.fanOut({
      joinRequestId,
      what: "requestExpired",
      sends: [
        this.mail.sendRequestExpired({
          requesterEmail,
          organizationName,
          ...(personalProjectUrl ? { personalProjectUrl } : {}),
        }),
      ],
    });
  }

  async joinedAutomatically({
    joinRequestId,
    organizationId,
    requesterUserId,
    domain,
  }: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void> {
    const [organizationName, memberName, admins, seats] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.adminEmails({ organizationId }),
      this.trySeats({ organizationId }),
    ]);
    await this.fanOut({
      joinRequestId,
      what: "joinedAutomatically",
      sends: admins.map((adminEmail) =>
        this.mail.sendJoinedAutomatically({
          adminEmail,
          organizationName,
          memberName,
          domain,
          ...(seats ? { seats } : {}),
        }),
      ),
    });
  }

  private async fanOut({
    joinRequestId,
    what,
    sends,
  }: {
    joinRequestId: string;
    what: string;
    sends: Promise<unknown>[];
  }): Promise<void> {
    const outcomes = await Promise.allSettled(sends);
    const failed = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failed.length > 0) {
      // Never fatal: the request is the durable fact and it stands whether or
      // not the mail went. A deployment with no email provider configured is
      // an ordinary self-hosted install, not an error.
      logger.warn(
        { joinRequestId, what, failed: failed.length, of: sends.length },
        "some join-request notifications could not be sent",
      );
    }
  }

  private async organizationName({ organizationId }: { organizationId: string }): Promise<string> {
    return this.audience.getOrganizationName({ organizationId }).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "organization_not_found")
        return "your organization";
      throw error;
    });
  }

  /**
   * Why the organization came, for the one message a new member reads first.
   * No intent is a supported answer — plenty of organizations never said.
   */
  private async organizationIntent({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ intent?: "AGENT_GOVERNANCE" | "LLM_OPS" }> {
    const organization = await this.context
      .getOrganizationIntent(organizationId)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "organization_not_found")
          return undefined;
        throw error;
      });

    return organization?.primaryIntent ? { intent: organization.primaryIntent } : {};
  }

  private async adminEmails({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.audience.findAdminEmails({ organizationId });
  }

  private async displayName({ userId }: { userId: string }): Promise<string> {
    return this.audience
      .getUserProfile({ userId })
      .then((profile) => profile.name ?? profile.email ?? "A colleague")
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "user_not_found") return "A colleague";
        throw error;
      });
  }

  private async emailOf({ userId }: { userId: string }): Promise<string | null> {
    return this.audience
      .getUserProfile({ userId })
      .then((profile) => profile.email)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "user_not_found") return null;
        throw error;
      });
  }

  /** How many join requests from this domain have already been approved. */
  private async approvedFromDomainCount({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<number> {
    return this.context.countApprovedFromDomain({ organizationId, domain });
  }

  /**
   * A personal project of the requester's own in any organization they hold one in, not necessarily
   * this one. `undefined` when they have none yet, the ordinary case for a first sign-in.
   */
  private async tryPersonalProjectUrl({ userId }: { userId: string }): Promise<string | undefined> {
    const [slug] = await this.context.findPersonalTeamSlugs(userId);
    return slug ? `${this.baseHost}/${slug}` : undefined;
  }

  /**
   * Seats held against what the plan covers, or nothing for an organization on enterprise or
   * negotiated terms — the same gate the invitation re-request mail's seat census uses, since a
   * public seat ceiling is not that organization's number either.
   */
  private async trySeats({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ used: number; ceiling: number } | undefined> {
    if (!this.plans || !this.memberships) return undefined;
    try {
      const plan = await this.plans.getActivePlan({ organizationId });
      const accountManaged =
        plan.planSource === "license" || plan.overrideAddingLimitations === true;
      if (accountManaged || plan.maxMembers <= 0) return undefined;

      return {
        used: await this.memberships.getMemberCount(organizationId),
        ceiling: plan.maxMembers,
      };
    } catch (error) {
      logger.warn(
        { organizationId, error },
        "Could not read the seat census for a domain-auto-join notice",
      );

      return undefined;
    }
  }
}
