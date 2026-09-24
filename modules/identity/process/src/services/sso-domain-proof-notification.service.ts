import { HandledError } from "@langwatch/handled-error";
import {
  SSO_DNS_RECORD_NAME,
  SSO_DNS_RECORD_TYPE,
  ssoDnsRecordName,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

import type { SsoDomainProofMail } from "../app/identity.members.ts";
import type { SsoDomainProofNotifications } from "../eventing/sso-domain-proof-notification.process.ts";
import type { JoinRequestAudience } from "../repositories/join-request-audience.repository.ts";

const logger = createLogger("langwatch:identity:sso-domain-proof-notification");

/** What an organization is called when its row no longer says. */
const UNNAMED_ORGANIZATION = "your organization";

/**
 * The two reads a domain-proof notice needs, answered by the repository the
 * join-request notices already read — one audience over one organization's
 * members, never a second repository over the same tables.
 */
export type SsoDomainProofAudience = Pick<
  JoinRequestAudience,
  "findAdminEmails" | "getOrganizationName"
>;

/**
 * Who hears that a domain's evidence went missing. Every fan-out is
 * `Promise.allSettled`, so one bouncing administrator cannot silence the
 * rest; a failure is logged without an address and the proof stands.
 */
export class SsoDomainProofNotificationService implements SsoDomainProofNotifications {
  static create(options: {
    audience: SsoDomainProofAudience;
    mail: SsoDomainProofMail;
  }): SsoDomainProofNotificationService {
    return new SsoDomainProofNotificationService(options.audience, options.mail);
  }

  private constructor(
    private readonly audience: SsoDomainProofAudience,
    private readonly mail: SsoDomainProofMail,
  ) {}

  /** The record is gone and the clock has started. One mail, per absence. */
  async proofWavering({
    connectionId,
    organizationId,
    domain,
    graceEndsAtMs,
  }: {
    connectionId: string;
    organizationId: string;
    domain: string;
    graceEndsAtMs: number;
  }): Promise<void> {
    const { organizationName, admins } = await this.readAudience({ organizationId });
    await this.fanOut({
      connectionId,
      what: "proofWavering",
      sends: admins.map((adminEmail) =>
        this.mail.sendProofWavering({
          adminEmail,
          organizationName,
          domain,
          record: proofRecord({ domain }),
          graceEndsAtMs,
        }),
      ),
    });
  }

  /** The grace ran out. Says what stopped, and as loudly what did not. */
  async proofLapsed({
    connectionId,
    organizationId,
    domain,
  }: {
    connectionId: string;
    organizationId: string;
    domain: string;
  }): Promise<void> {
    const { organizationName, admins } = await this.readAudience({ organizationId });
    await this.fanOut({
      connectionId,
      what: "proofLapsed",
      sends: admins.map((adminEmail) =>
        this.mail.sendProofLapsed({
          adminEmail,
          organizationName,
          domain,
          record: proofRecord({ domain }),
        }),
      ),
    });
  }

  private async readAudience({ organizationId }: { organizationId: string }): Promise<{
    organizationName: string;
    admins: readonly string[];
  }> {
    const [organizationName, admins] = await Promise.all([
      this.audience.getOrganizationName({ organizationId }).catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "organization_not_found")
          return UNNAMED_ORGANIZATION;
        throw error;
      }),
      this.audience.findAdminEmails({ organizationId }),
    ]);
    return { organizationName, admins };
  }

  private async fanOut({
    connectionId,
    what,
    sends,
  }: {
    connectionId: string;
    what: string;
    sends: Promise<unknown>[];
  }): Promise<void> {
    const outcomes = await Promise.allSettled(sends);
    const failed = outcomes.filter((outcome) => outcome.status === "rejected");
    if (failed.length > 0) {
      // Never fatal: the proof's state is the durable fact and it stands
      // whether or not the mail went.
      logger.warn(
        { connectionId, what, failed: failed.length, of: sends.length },
        "some domain-proof notifications could not be sent",
      );
    }
  }
}

/**
 * What to publish, as both mails print it. The fact says which domain lost
 * its evidence, not which method proved it, so the mails name the DNS record
 * — the only method whose value an administrator republishes by hand.
 */
function proofRecord({ domain }: { domain: string }): {
  recordType: string;
  recordName: string;
  recordLabel: string;
} {
  return {
    recordType: SSO_DNS_RECORD_TYPE,
    recordName: ssoDnsRecordName({ domain }),
    recordLabel: SSO_DNS_RECORD_NAME,
  };
}

/** The domain whose proof moved, and the organization nobody heard from. */
type UnsentNotice = { connectionId: string; organizationId: string; domain: string };

/**
 * The notices, unsent: this process composed no mail gateway. A warn rather
 * than a refusal, because a thrown intent would redeliver for ever while the
 * proof's own state — what actually stops new arrivals — has already moved.
 */
export class UnaddressedSsoDomainProofNotifications implements SsoDomainProofNotifications {
  static create(): UnaddressedSsoDomainProofNotifications {
    return new UnaddressedSsoDomainProofNotifications();
  }

  private constructor() {}

  proofWavering(input: UnsentNotice & { graceEndsAtMs: number }): Promise<void> {
    const { graceEndsAtMs: _deadline, ...notice } = input;
    this.unsent("proofWavering", notice);
    return Promise.resolve();
  }

  proofLapsed(input: UnsentNotice): Promise<void> {
    this.unsent("proofLapsed", input);
    return Promise.resolve();
  }

  private unsent(what: string, input: UnsentNotice): void {
    logger.warn(
      { ...input, what, reason: "no-mail-capability" },
      "a domain's proof changed state and no administrator was told: this process composes no mail gateway",
    );
  }
}
