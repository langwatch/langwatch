import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { JoinRequestMail } from "../app/identity.members.ts";
import type { JoinRequestAudienceRepository } from "../repositories/join-request-audience.repository.ts";

const logger = createLogger("langwatch:identity:join-request-notification");

/** What an organization is called when its row no longer says. */
const UNNAMED_ORGANIZATION = "your organization";

/** What a requester is called when neither a name nor an address survives. */
const UNNAMED_REQUESTER = "A colleague";

/**
 * Who is told when a join request's own timers fire, and what happens when telling them fails.
 * Every fan-out is `Promise.allSettled`, so one bouncing admin address can't silence the rest;
 * a failed mail is logged and the request stands, and the log line never names an address.
 */
export class JoinRequestNotificationService {
  static create(options: {
    audience: JoinRequestAudienceRepository;
    mail: JoinRequestMail;
  }): JoinRequestNotificationService {
    return new JoinRequestNotificationService(options.audience, options.mail);
  }

  private constructor(
    private readonly audience: JoinRequestAudienceRepository,
    private readonly mail: JoinRequestMail,
  ) {}

  /**
   * The day-7 nudge, to every admin of the organization being asked. The
   * requester is read through the request, not passed in: the wake carries
   * only the request and tenant, keeping process state free of identity.
   */
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

    if (!requesterUserId) {
      return;
    }

    const [organizationName, requesterName, admins] = await Promise.all([
      this.organizationName({ organizationId }),
      this.displayName({ userId: requesterUserId }),
      this.audience.findAdminEmails({ organizationId }),
    ]);

    await this.fanOut({
      joinRequestId,
      what: "requestStillWaiting",
      sends: admins.map((adminEmail) =>
        this.mail.sendStillWaiting({ adminEmail, organizationName, requesterName }),
      ),
    });
  }

  /** The lapse notice, to the one person who asked. */
  async requestExpired({
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
      this.audience
        .getUserProfile({ userId: requesterUserId })
        .then((profile) => profile.email)
        .catch((error: unknown) => {
          if (HandledError.isHandled(error) && error.code === "user_not_found") return null;
          throw error;
        }),
    ]);
    if (!requesterEmail) {
      return;
    }

    await this.fanOut({
      joinRequestId,
      what: "requestExpired",
      sends: [this.mail.sendExpired({ requesterEmail, organizationName })],
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
      // not the mail went.
      logger.warn(
        { joinRequestId, what, failed: failed.length, of: sends.length },
        "some join-request notifications could not be sent",
      );
    }
  }

  private async organizationName({ organizationId }: { organizationId: string }): Promise<string> {
    return this.audience.getOrganizationName({ organizationId }).catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "organization_not_found")
        return UNNAMED_ORGANIZATION;
      throw error;
    });
  }

  private async displayName({ userId }: { userId: string }): Promise<string> {
    return this.audience
      .getUserProfile({ userId })
      .then((profile) => profile.name ?? profile.email ?? UNNAMED_REQUESTER)
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "user_not_found") {
          return UNNAMED_REQUESTER;
        }
        throw error;
      });
  }
}
