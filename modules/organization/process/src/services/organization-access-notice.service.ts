import { describeSignInIdp } from "@langwatch/identity-contract";
import type { Logger } from "@langwatch/observability";
import type { SeatApprovalPath } from "@langwatch/organization-contract";
import { Temporal } from "@langwatch/time";

import type { AccessNoticeMailChannel } from "../channels/access-notice-mail.channel.ts";
import type { AccessNoticePushChannel } from "../channels/access-notice-push.channel.ts";
import type {
  AccessNoticeKind,
  AccessNoticeRow,
  OrganizationAccessNoticeRepository,
} from "../repositories/organization-access-notice.repository.ts";

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
  push: AccessNoticePushChannel;
  context: AccessNoticeContext;
  /** The Users page's People tab, or null when no public origin is set to link from. */
  requestsUrl: string | null;
  /** Where LangWatch opens for the person who asked, or null with no public origin. */
  appUrl: string | null;
  now: () => number;
  newId: () => string;
  logger: Logger;
}>;

/** Where an administrator's push opens: the People tab, where seat requests are answered. */
const SEAT_REQUESTS_PATH = "/settings/directory?tab=people";

/** Where the person who asked lands once answered. */
const APP_HOME_PATH = "/";

/** The UTC day a notice counts toward, YYYY-MM-DD. */
function dayKeyOf(at: number): string {
  return Temporal.Instant.fromEpochMilliseconds(at).toString().slice(0, 10);
}

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
    /** A Lite Member pressed Request access, and what they were trying to do. */
    askedFor?: { reason: string | null };
    /** The seat request the notice is about; a member's own ask is also pushed in-app. */
    seatRequestId?: string;
  }): Promise<{ recorded: boolean; mailed: boolean }> {
    const { notices, now, newId } = this.dependencies;
    const at = now();
    // A member's own ask is pushed first, so it goes even when the notice cannot be recorded or
    // today's was already mailed; the push dedupes on its own key.
    if (input.askedFor && input.seatRequestId) {
      await this.pushAsked({
        organizationId: input.organizationId,
        who: input.name ?? input.email,
        dayKey: dayKeyOf(at),
        seatRequestId: input.seatRequestId,
        reason: input.askedFor.reason,
      });
    }
    const [notice] = await notices.record({
      id: newId(),
      organizationId: input.organizationId,
      kind: input.kind,
      email: input.email,
      name: input.name,
      idp: input.idp,
      idpRefused: input.idpRefused,
      dayKey: dayKeyOf(at),
      at,
    });
    if (!notice) return { recorded: false, mailed: false };

    const [claimed] = await notices.markMailed({ ids: [notice.id], at });
    if (!claimed) return { recorded: true, mailed: false };
    const reached = await this.mailOne({
      notice,
      heldWithoutAccess: input.heldWithoutAccess ?? true,
      askedFor: input.askedFor ?? null,
    }).catch((error: unknown) => {
      this.dependencies.logger.warn(
        { organizationId: notice.organizationId, kind: notice.kind, error },
        "access notice could not be composed",
      );
      return false;
    });
    if (!reached) {
      await notices.releaseMailed({ id: notice.id });
      return { recorded: true, mailed: false };
    }
    return { recorded: true, mailed: true };
  }

  /** Notices about refused sign-ins the organization recorded today, both kinds together. */
  refusedSignInsToday({ organizationId }: { organizationId: string }): Promise<number> {
    return this.dependencies.notices.countRefusedForDay({
      organizationId,
      dayKey: dayKeyOf(this.dependencies.now()),
    });
  }

  /**
   * The answer to the person who asked, mailed once per answer; throws when it could not go.
   * `openedAt` names the opening answered, so a reopened request's next answer is its own.
   */
  async mailAnswer(input: {
    organizationId: string;
    seatRequestId: string;
    openedAt: number;
    email: string;
    outcome: "approved" | "declined";
  }): Promise<void> {
    const { context, mail, appUrl, now } = this.dependencies;
    await mail.sendSeatRequestAnswered({
      recipientEmail: input.email,
      organizationName: await context.organizationName({ organizationId: input.organizationId }),
      outcome: input.outcome,
      appUrl,
      idempotencyKey: `seat-request-answer:${input.seatRequestId}:${input.openedAt}:${input.outcome}:${dayKeyOf(now())}`,
    });
  }

  /** The in-app answer to the person who asked, pushed once per answer; never throws. */
  async pushAnswer(input: {
    organizationId: string;
    seatRequestId: string;
    openedAt: number;
    userId: string;
    outcome: "approved" | "declined";
  }): Promise<void> {
    const { context, push, logger } = this.dependencies;
    const { organizationId, seatRequestId, openedAt, outcome } = input;
    try {
      const organizationName = await context.organizationName({ organizationId });
      await push.push({
        userId: input.userId,
        organizationId,
        idempotencyKey: `seat-request-answer-push:${seatRequestId}:${openedAt}:${outcome}`,
        topic: `seat-request:${seatRequestId}`,
        title: `Your seat request was ${outcome}`,
        body:
          outcome === "approved"
            ? `You have a full seat in ${organizationName}.`
            : `An admin of ${organizationName} declined it.`,
        url: APP_HOME_PATH,
      });
    } catch (error: unknown) {
      logger.warn({ organizationId, error }, "could not push the seat request answer");
    }
  }

  /** Pushes a member's own ask to everyone the mail goes to; a failed push is only logged. */
  private async pushAsked({
    organizationId,
    who,
    dayKey,
    seatRequestId,
    reason,
  }: {
    organizationId: string;
    who: string;
    dayKey: string;
    seatRequestId: string;
    reason: string | null;
  }): Promise<void> {
    const { context, push, logger } = this.dependencies;
    const recipients = await context.recipients({ organizationId }).catch((error: unknown) => {
      logger.warn({ organizationId, error }, "seat request push found no recipients");
      return [];
    });
    const outcomes = await Promise.allSettled(
      recipients.map((recipient) =>
        push.push({
          userId: recipient.userId,
          organizationId,
          idempotencyKey: `seat-request-push:${seatRequestId}:${recipient.userId}:${dayKey}`,
          topic: `seat-request:${seatRequestId}`,
          title: `${who} asked for a full seat`,
          body: reason ? `To ${reason}` : `${who} asked for a full seat.`,
          url: SEAT_REQUESTS_PATH,
        }),
      ),
    );
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    if (failed > 0) {
      logger.warn(
        { organizationId, failed, of: recipients.length },
        "some seat request pushes failed",
      );
    }
  }

  private async mailOne({
    notice,
    heldWithoutAccess,
    askedFor,
  }: {
    notice: AccessNoticeRow;
    heldWithoutAccess: boolean;
    askedFor: { reason: string | null } | null;
  }): Promise<boolean> {
    const { context, mail, requestsUrl } = this.dependencies;
    const { organizationId } = notice;
    const [recipients, organizationName] = await Promise.all([
      context.recipients({ organizationId }),
      context.organizationName({ organizationId }),
    ]);
    const idpName = describeSignInIdp(notice.idp) ?? null;
    const approval =
      notice.kind === "seat_request" ? await context.approval({ organizationId }) : null;
    return this.fanOut({
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
              askedFor,
              idpRefused: notice.idpRefused ? { idpName } : null,
              approval,
              requestsUrl,
            })
          : mail.sendIdpRefused({ ...envelope, idpName });
      }),
    });
  }

  /**
   * One bouncing address must not silence the rest: the notice stands once any send went.
   * Answers false when none did or there was no one to mail, so a later arrival retries it.
   */
  private async fanOut({
    organizationId,
    what,
    sends,
  }: {
    organizationId: string;
    what: string;
    sends: Promise<unknown>[];
  }): Promise<boolean> {
    if (sends.length === 0) {
      this.dependencies.logger.warn(
        { organizationId, what },
        "an access notice has no one to mail",
      );
      return false;
    }
    const outcomes = await Promise.allSettled(sends);
    const failed = outcomes.filter((outcome) => outcome.status === "rejected").length;
    if (failed > 0) {
      this.dependencies.logger.warn(
        { organizationId, what, failed, of: sends.length },
        "some access notices could not be mailed",
      );
    }
    return failed < sends.length;
  }
}
