// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  AmbiguousSubscriptionError,
  type BlockedSeatChangeAttempt,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { format, nowInstant, type Instant } from "@langwatch/time";

import type { BillingFixedEmailChannel } from "../channels/billing-fixed-email.channel.ts";
import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import type {
  BlockedSeatChange,
  BlockedSeatChangeRepository,
} from "../repositories/blocked-seat-change.repository.ts";
import type { SeatEventProrationQuote } from "../rules/seat-event-quote.rules.ts";

const logger = createLogger("langwatch:billing:blocked-seat-change");

/** The same attempt asked again while it still waits is one change, whatever order its fields came in. */
function attemptKey(attempt: BlockedSeatChangeAttempt): string {
  return JSON.stringify(Object.entries(attempt).toSorted(([a], [b]) => a.localeCompare(b)));
}

/** A change no one could finish in two weeks is dropped untold: the email would mislead by then. */
const WAIT_LIMIT_MS = 14 * 24 * 60 * 60 * 1000;

type BlockedSeatChangeOptions = {
  changes: BlockedSeatChangeRepository;
  organizations: Pick<BillingAccountFactsRepository, "findName" | "findMemberEmails">;
  /** The quote for seats beyond today's; refuses `subscription_ambiguous` while still blocked. */
  quote: (input: { organizationId: string; added: number }) => Promise<SeatEventProrationQuote>;
  emails: BillingFixedEmailChannel;
  publicBaseUrl: string;
  now?: () => Instant;
};

/**
 * Seat changes refused for two live subscriptions: kept per admin, and once the organization is
 * back on one plan, one email to each admin with what finishing the change costs now.
 */
export class BlockedSeatChangeService {
  static create(options: BlockedSeatChangeOptions): BlockedSeatChangeService {
    return new BlockedSeatChangeService(options);
  }

  private constructor(private readonly options: BlockedSeatChangeOptions) {}

  /** Keeps a refused change for its admin; false when it could not be kept. Never throws. */
  async record(input: {
    organizationId: string;
    userId: string;
    attempt: BlockedSeatChangeAttempt;
    seats: number;
  }): Promise<boolean> {
    try {
      const key = attemptKey(input.attempt);
      const waiting = await this.options.changes.findWaitingFor({
        organizationId: input.organizationId,
        userId: input.userId,
      });
      const known = waiting.some((change) => attemptKey(change.attempt) === key);
      if (!known) await this.options.changes.record(input);
      return true;
    } catch (error) {
      logger.error({ error, organizationId: input.organizationId }, "Refused seat change not kept");
      return false;
    }
  }

  /** One pass: tells each waiting admin whose organization is no longer blocked. */
  async noticeFixed(): Promise<{ sent: number; waiting: number }> {
    const now = (this.options.now ?? nowInstant)();
    const latest = new Map<string, BlockedSeatChange>();
    for (const change of await this.options.changes.findWaiting()) {
      latest.set(`${change.organizationId}:${change.userId}`, change);
    }
    const blocked = new Set<string>();
    let sent = 0;
    for (const change of latest.values()) {
      if (blocked.has(change.organizationId)) continue;
      const outcome = await this.noticeOne({ change, now });
      if (outcome === "blocked") blocked.add(change.organizationId);
      if (outcome === "sent") sent += 1;
    }
    return { sent, waiting: latest.size - sent };
  }

  private async noticeOne({
    change,
    now,
  }: {
    change: BlockedSeatChange;
    now: Instant;
  }): Promise<"sent" | "blocked" | "dropped" | "retry"> {
    const { organizationId, userId } = change;
    const done = () =>
      this.options.changes.markNotified({
        organizationId,
        userId,
        createdUpTo: change.createdAt,
        at: now,
      });
    if (now.epochMilliseconds - change.createdAt.epochMilliseconds > WAIT_LIMIT_MS) {
      await done();
      return "dropped";
    }
    try {
      const quote = await this.options.quote({ organizationId, added: change.seats });
      const [recipient] = await this.options.organizations.findMemberEmails({
        organizationId,
        userIds: [userId],
      });
      const organization = await this.options.organizations.findName(organizationId);
      if (!recipient || !organization || quote.renewsAt == null) {
        await done();
        return "dropped";
      }
      await this.options.emails.send({
        to: recipient.email,
        email: {
          organizationName: organization.name,
          tried: change.attempt,
          triedWhen: triedWhen({ at: change.createdAt, now }),
          seats: change.seats,
          dueToday: quote.formattedAmountDue,
          recurringTotal: quote.formattedRecurringTotal,
          interval: quote.billingInterval === "year" ? "year" : "month",
          renewsOn: readableDate(quote.renewsAt),
          actionUrl: `${this.options.publicBaseUrl}/settings/members`,
        },
      });
      await done();
      return "sent";
    } catch (error) {
      if (error instanceof AmbiguousSubscriptionError) return "blocked";
      logger.warn({ error, organizationId }, "Billing-fixed email not sent; retried next pass");
      return "retry";
    }
  }
}

const readableDate = (epochMs: number) => format(epochMs, "d MMMM yyyy", { timeZone: "UTC" });

function triedWhen({ at, now }: { at: Instant; now: Instant }): string {
  const day = readableDate(at.epochMilliseconds);
  return day === readableDate(now.epochMilliseconds) ? "earlier today" : `on ${day}`;
}
