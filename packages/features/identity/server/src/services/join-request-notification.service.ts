import { createLogger } from "@langwatch/observability";
import type { JoinRequestAudiencePort } from "../ports/join-request-audience.port";
import type { JoinRequestMailPort } from "../ports/join-request-mail.port";

const logger = createLogger("langwatch:identity:join-request-notification");

/** What an organization is called when its row no longer says. */
const UNNAMED_ORGANIZATION = "your organization";

/** What a requester is called when neither a name nor an address survives. */
const UNNAMED_REQUESTER = "A colleague";

/**
 * Who is told when a join request's own timers fire, and what happens when
 * telling them fails.
 *
 * Every fan-out is `Promise.allSettled`, for the reason the re-request mail
 * gives: one bouncing admin address must not silence the rest. A mail that
 * cannot be sent is logged and the request stands — the durable fact is the
 * request, not the notification, and a deployment with no email provider
 * configured is an ordinary self-hosted install rather than an error.
 *
 * The log line names the request and the count, never an address: a
 * notification failure is an operational fact, and turning one into a list of
 * who works where would make the log a directory.
 */
export class JoinRequestNotificationService {
  static create(options: {
    audience: JoinRequestAudiencePort;
    mail: JoinRequestMailPort;
  }): JoinRequestNotificationService {
    return new JoinRequestNotificationService(options.audience, options.mail);
  }

  private constructor(
    private readonly audience: JoinRequestAudiencePort,
    private readonly mail: JoinRequestMailPort,
  ) {}

  /**
   * The day-7 nudge, to every admin of the organization being asked.
   *
   * The requester is read through the request rather than passed in: the wake
   * carries the request and the tenant, and asking the row who made it keeps
   * the process manager's state free of a person's identity.
   */
  async requestStillWaiting({
    joinRequestId,
    organizationId,
  }: {
    joinRequestId: string;
    organizationId: string;
  }): Promise<void> {
    const requesterUserId = await this.audience.tryFindRequesterId({ joinRequestId });

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
      this.audience.tryFindEmail({ userId: requesterUserId }),
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
    return (
      (await this.audience.tryFindOrganizationName({ organizationId })) ?? UNNAMED_ORGANIZATION
    );
  }

  private async displayName({ userId }: { userId: string }): Promise<string> {
    return (await this.audience.tryFindDisplayName({ userId })) ?? UNNAMED_REQUESTER;
  }
}
