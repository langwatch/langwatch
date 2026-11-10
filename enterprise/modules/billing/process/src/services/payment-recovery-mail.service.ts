// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AuthzApi } from "@langwatch/authz-contract";
import { getFreePlanLimits, PLAN_LIMITS } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { format, Temporal, type Instant } from "@langwatch/time";

import type {
  PaymentRecoveryEmail,
  PaymentRecoveryEmailChannel,
} from "../channels/payment-recovery-email.channel.ts";
import type { BillingInvoiceDetail } from "../channels/stripe-invoices.channel.ts";
import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import type { PaymentRecoveryCase } from "../repositories/payment-recovery.repository.ts";
import { accessStopsAt } from "../rules/payment-recovery.rules.ts";

const logger = createLogger("langwatch:billing:payment-recovery");

type Recipient = { userId: string; email: string };

export type PreparedMail = {
  organizationId: string;
  recipients: Recipient[];
  content: PaymentRecoveryEmail;
};

type PaymentRecoveryMailOptions = {
  organizations: Pick<BillingAccountFactsRepository, "findWithAdministrators" | "findMemberEmails">;
  /** Who holds the Billing role; absent where no authorization is composed, then admins only. */
  billingMembers?: Pick<AuthzApi, "listBillingMembers">;
  emails: PaymentRecoveryEmailChannel;
  publicBaseUrl: string;
};

/** Who hears about a failed payment, what the email says, and its delivery. */
export class PaymentRecoveryMailService {
  static create(options: PaymentRecoveryMailOptions): PaymentRecoveryMailService {
    return new PaymentRecoveryMailService(options);
  }

  private constructor(private readonly options: PaymentRecoveryMailOptions) {}

  /** Resolves who gets the email and its content; every lookup that can fail happens here. */
  async prepare({
    kind,
    open,
    invoice,
  }: {
    kind: PaymentRecoveryEmail["kind"];
    open: PaymentRecoveryCase;
    invoice: BillingInvoiceDetail;
  }): Promise<PreparedMail> {
    const { organizationId } = open;
    const { organizationName, recipients } = await this.recipientsOf(organizationId);
    return {
      organizationId,
      recipients,
      content: this.emailOf({ kind, organizationName, open, invoice }),
    };
  }

  /** Sends to each person who can pay; one refused address does not stop the others. */
  async deliver({ organizationId, recipients, content }: PreparedMail): Promise<void> {
    if (recipients.length === 0) {
      logger.warn(
        { organizationId },
        "Payment recovery notice has no recipients; recorded as sent",
      );
      return;
    }
    for (const recipient of recipients) {
      try {
        await this.options.emails.send({ to: recipient.email, email: content });
      } catch (error) {
        logger.warn(
          {
            organizationId,
            userId: recipient.userId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Payment recovery email refused for one recipient",
        );
      }
    }
  }

  /** An invoice amount in minor units, as the emails and the account alert show it. */
  amountOf({ amount, currency }: { amount: number; currency: string }): string {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  }

  /** Admins and Billing members with an address, each once. */
  private async recipientsOf(
    organizationId: string,
  ): Promise<{ organizationName: string; recipients: Recipient[] }> {
    const organization = await this.options.organizations.findWithAdministrators(organizationId);
    const admins = (organization?.administrators ?? []).flatMap((admin) =>
      admin.email ? [{ userId: admin.userId, email: admin.email }] : [],
    );
    const holders = this.options.billingMembers
      ? await this.options.billingMembers.listBillingMembers({ organizationId })
      : [];
    const billing = await this.options.organizations.findMemberEmails({
      organizationId,
      userIds: holders.map((holder) => holder.userId),
    });
    const byUser = new Map<string, Recipient>();
    for (const recipient of [...admins, ...billing]) byUser.set(recipient.userId, recipient);
    return {
      organizationName: organization?.name ?? "Your organization",
      recipients: [...byUser.values()],
    };
  }

  private emailOf({
    kind,
    organizationName,
    open,
    invoice,
  }: {
    kind: PaymentRecoveryEmail["kind"];
    organizationName: string;
    open: PaymentRecoveryCase;
    invoice: BillingInvoiceDetail;
  }): PaymentRecoveryEmail {
    const base = this.options.publicBaseUrl;
    const actionUrl = {
      failed: `${base}/settings/subscription?updateCard=1`,
      reminder: `${base}/settings/subscription?updateCard=1`,
      final: `${base}/settings/subscription?pay=1`,
      paused: `${base}/settings/subscription?pay=1`,
      restored: base,
    }[kind];
    const free = getFreePlanLimits();
    return {
      kind,
      organizationName,
      planName: planNameOf(open.plan),
      amount: this.amountOf({ amount: invoice.amountDue, currency: invoice.currency }),
      ...(invoice.number ? { invoiceNumber: invoice.number } : {}),
      invoiceDate: readableDate(Temporal.Instant.fromEpochMilliseconds(invoice.created * 1000)),
      accessStopsOn: readableDate(accessStopsAt({ startedAt: open.startedAt })),
      ...(invoice.card ? { card: invoice.card } : {}),
      ...(kind === "final"
        ? {
            freeLimits: {
              eventsPerMonth: free.maxMessagesPerMonth,
              eachOfScenarios: free.maxScenarios ?? 0,
            },
          }
        : {}),
      actionUrl,
    };
  }
}

function planNameOf(plan: string): string {
  const limits = (PLAN_LIMITS as Record<string, { name?: string } | undefined>)[plan];
  return limits?.name ?? "paid";
}

/** "23 November 2026", in UTC, the way the emails name a date. */
function readableDate(instant: Instant): string {
  return format(instant.epochMilliseconds, "d MMMM yyyy", { timeZone: "UTC" });
}
