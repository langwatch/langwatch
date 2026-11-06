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

/** The most people one digest names; the mail counts the rest. */
export const ACCESS_DIGEST_MAX_NAMES = 20;

/** One window per organization: the first notice in it is mailed, the rest wait for the digest. */
export const ACCESS_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

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
 * The bounded mail behind seat requests and refused sign-ins (ruling R5): at most one notice per
 * person, kind and day; the first in an organization's 24-hour window is mailed at once and the
 * rest go out together when the window closes.
 */
export class OrganizationAccessNoticeService {
  static create(dependencies: Dependencies): OrganizationAccessNoticeService {
    return new OrganizationAccessNoticeService(dependencies);
  }

  private constructor(private readonly dependencies: Dependencies) {}

  /** Records one notice and mails it when the window is open; answers whether it was new. */
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

    const { lastMailedAt } = await notices.getMailWindow({ organizationId: input.organizationId });
    if (lastMailedAt !== null && at - lastMailedAt < ACCESS_NOTICE_WINDOW_MS) {
      return { recorded: true, mailed: false };
    }
    const held = await notices.findHeld({ organizationId: input.organizationId });
    if (held.some((row) => row.id !== notice.id)) {
      // A window closed before the sweep ran: what it held goes out now, with this notice.
      const mailed = await this.mailHeld({ organizationId: input.organizationId, held, at });
      return { recorded: true, mailed: mailed.has(notice.id) };
    }
    const [claimed] = await notices.markMailed({ ids: [notice.id], delivery: "immediate", at });
    if (!claimed) return { recorded: true, mailed: false };
    await this.mailOne({ notice, heldWithoutAccess: input.heldWithoutAccess ?? true });
    return { recorded: true, mailed: true };
  }

  /** Mails one digest to every organization whose window closed with notices held. */
  async sendDueDigests(): Promise<{ digests: number }> {
    const { notices, now } = this.dependencies;
    let digests = 0;
    for (const organizationId of await notices.findOrganizationsWithHeld()) {
      const at = now();
      const { lastMailedAt } = await notices.getMailWindow({ organizationId });
      if (lastMailedAt !== null && at - lastMailedAt < ACCESS_NOTICE_WINDOW_MS) continue;
      const held = await notices.findHeld({ organizationId });
      const mailed = await this.mailHeld({ organizationId, held, at });
      if (mailed.size > 0) digests += 1;
    }
    return { digests };
  }

  /** Claims the held notices and mails the ones this process won as one digest. */
  private async mailHeld({
    organizationId,
    held,
    at,
  }: {
    organizationId: string;
    held: readonly AccessNoticeRow[];
    at: number;
  }): Promise<ReadonlySet<string>> {
    const claimedIds = new Set(
      await this.dependencies.notices.markMailed({
        ids: held.map((row) => row.id),
        delivery: "digest",
        at,
      }),
    );
    const claimed = held.filter((row) => claimedIds.has(row.id));
    if (claimed.length > 0) await this.mailDigest({ organizationId, notices: claimed });
    return claimedIds;
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

  private async mailDigest({
    organizationId,
    notices,
  }: {
    organizationId: string;
    notices: readonly AccessNoticeRow[];
  }): Promise<void> {
    const { context, mail, requestsUrl } = this.dependencies;
    const [recipients, organizationName] = await Promise.all([
      context.recipients({ organizationId }),
      context.organizationName({ organizationId }),
    ]);
    const people = notices.slice(0, ACCESS_DIGEST_MAX_NAMES).map((notice) => ({
      name: notice.name,
      email: notice.email,
      kind: notice.kind,
      idpName: (notice.idp && IDENTITY_PROVIDER_NAMES[notice.idp]) || null,
    }));
    const digestKey = notices[0]?.id ?? "";
    await this.fanOut({
      organizationId,
      what: "digest",
      sends: recipients.map((recipient) =>
        mail.sendDigest({
          recipientEmail: recipient.email,
          organizationName,
          people,
          moreCount: notices.length - people.length,
          requestsUrl,
          idempotencyKey: `access-digest:${digestKey}:${recipient.userId}`,
        }),
      ),
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
