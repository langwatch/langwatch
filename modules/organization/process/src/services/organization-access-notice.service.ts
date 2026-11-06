import type { Logger } from "@langwatch/observability";
import type { SeatApprovalPath } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";

import type { AccessNoticeMailChannel } from "../channels/access-notice-mail.channel.ts";
import type {
  AccessNoticeKind,
  AccessNoticeRow,
  OrganizationAccessNoticeRepository,
} from "../repositories/organization-access-notice.repository.ts";
import { IDENTITY_PROVIDER_NAMES } from "../rules/identity-provider-name.rules.ts";

/** Someone told about seat requests: an active administrator or a Billing member. */
export type AccessNoticeRecipient = Readonly<{ userId: string; email: string }>;

/** How the seat request mail words the approval; `seat_free` when a seat is free already. */
export type AccessNoticeApproval =
  | Readonly<{ kind: "seat_free" }>
  | Readonly<{
      kind: "stripe_seats";
      seatPrice: Extract<SeatApprovalPath, { kind: "stripe_seats" }>["seatPrice"];
    }>
  | Readonly<{ kind: "upgrade_plan" | "contact_sales" | "upgrade_licence" }>;

/** The reads a notice is composed from, all organization's own or its peers'. */
export interface AccessNoticeContext {
  recipients(input: { organizationId: string }): Promise<AccessNoticeRecipient[]>;
  organizationName(input: { organizationId: string }): Promise<string>;
  approval(input: { organizationId: string }): Promise<AccessNoticeApproval>;
}

type Dependencies = Readonly<{
  notices: OrganizationAccessNoticeRepository;
  mail: AccessNoticeMailChannel;
  context: AccessNoticeContext;
  /** The members screen's requests tab, where every notice links. */
  requestsUrl: string;
  now: () => number;
  newId: () => string;
  logger: Logger;
}>;

/**
 * The mail behind seat requests and refused sign-ins (ruling R5): each person's notice is mailed at
 * once, and the same person is noticed at most once a day per kind.
 */
export class OrganizationAccessNoticeService {
  static create(dependencies: Dependencies): OrganizationAccessNoticeService {
    return new OrganizationAccessNoticeService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /** Records one notice and mails it at once; a repeat the same day records and mails nothing. */
  async record(input: {
    organizationId: string;
    kind: AccessNoticeKind;
    email: string;
    name: string | null;
    idp: string | null;
    idpRefused: boolean;
    /** A seat request left the person with no access, rather than view-only access. */
    heldWithoutAccess?: boolean;
  }): Promise<{ recorded: boolean; mailed: boolean }> {
    const { notices, now, newId } = this.dependencies;
    const at = now();
    const [notice] = await notices.record({
      id: newId(),
      organizationId: input.organizationId,
      kind: input.kind,
      email: input.email,
      name: input.name,
      idp: input.idp,
      idpRefused: input.idpRefused,
      dayKey: Temporal.Instant.fromEpochMilliseconds(at).toString().slice(0, 10),
      at,
    });
    if (!notice) return { recorded: false, mailed: false };

    const [claimed] = await notices.markMailed({ ids: [notice.id], at });
    if (!claimed) return { recorded: true, mailed: false };
    await this.mailOne({ notice, heldWithoutAccess: input.heldWithoutAccess ?? true });
    return { recorded: true, mailed: true };
  }

  private async mailOne({
    notice,
    heldWithoutAccess,
  }: {
    notice: AccessNoticeRow;
    heldWithoutAccess: boolean;
  }): Promise<void> {
    const { context, mail, requestsUrl } = this.dependencies;
    const { organizationId } = notice;
    const [recipients, organizationName] = await Promise.all([
      context.recipients({ organizationId }),
      context.organizationName({ organizationId }),
    ]);
    const idpName = (notice.idp && IDENTITY_PROVIDER_NAMES[notice.idp]) || null;
    const approval =
      notice.kind === "seat_request" ? await context.approval({ organizationId }) : null;
    await this.fanOut({
      organizationId,
      what: notice.kind,
      sends: recipients.map((recipient) => {
        const envelope = {
          recipientEmail: recipient.email,
          organizationName,
          personName: notice.name,
          personEmail: notice.email,
          idempotencyKey: `access-notice:${notice.id}:${recipient.userId}`,
        };
        return approval
          ? mail.sendSeatRequest({
              ...envelope,
              heldWithoutAccess,
              idpRefused: notice.idpRefused ? { idpName } : null,
              approval,
              requestsUrl,
            })
          : mail.sendIdpRefused({ ...envelope, idpName });
      }),
    });
  }

  /** One bouncing address must not silence the rest; the notice stands whether or not it went. */
  private async fanOut({
    organizationId,
    what,
    sends,
  }: {
    organizationId: string;
    what: string;
    sends: Promise<unknown>[];
  }): Promise<void> {
    const outcomes = await Promise.allSettled(sends);
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    if (failed > 0) {
      this.dependencies.logger.warn(
        { organizationId, what, failed, of: sends.length },
        "some access notices could not be mailed",
      );
    }
  }
}
