// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Failed payment recovery (adrs/002-failed-payment-recovery.md): a renewal charge that fails
 * opens a case, people who can pay are told on day 3 and reminded, the organization moves to the
 * Free plan on day 21, and paying the invoice closes the case at once.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  PlanTypes,
  SubscriptionStatus,
  type PaymentRecoveryDetails,
  type PaymentRecoveryPayLink,
  type PaymentRecoverySummary,
} from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { BillingWebhookHost } from "../channels/billing-webhook-host.channel.ts";
import type { PaymentRecoveryEmailChannel } from "../channels/payment-recovery-email.channel.ts";
import type {
  BillingInvoiceDetail,
  StripeInvoicesChannel,
} from "../channels/stripe-invoices.channel.ts";
import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import type { BillingWebhookSubscriptionRepository } from "../repositories/billing-webhook-subscription.repository.ts";
import type {
  PaymentRecoveryCase,
  PaymentRecoveryRepository,
} from "../repositories/payment-recovery.repository.ts";
import {
  accessStopsAt,
  dueNotice,
  isPlanPausedForRecovery,
  noticeKindOf,
  type PaymentRecoveryNoticeDay,
} from "../rules/payment-recovery.rules.ts";
import type { OverPlanService } from "./over-plan.service.ts";
import { PaymentRecoveryMailService, type PreparedMail } from "./payment-recovery-mail.service.ts";

const logger = createLogger("langwatch:billing:payment-recovery");

/** The fields of a Stripe invoice recovery reads, as the webhook hands them over. */
export type RecoveryInvoice = Readonly<{
  id: string;
  subscriptionId: string | null;
  collectionMethod: string | null;
  billingReason: string | null;
  amountDue: number;
  currency: string;
  number: string | null;
  /** Epoch seconds. */
  created: number;
}>;

/** Renewals and mid-cycle changes; a first checkout's failure is the checkout's, not recovery's. */
const RECOVERABLE_BILLING_REASONS = new Set(["subscription_cycle", "subscription_update"]);

export type PaymentRecoverySweepOutcome = {
  notified: number;
  closed: number;
  failed: number;
};

type PaymentRecoveryOptions = {
  recoveries: PaymentRecoveryRepository;
  subscriptions: Pick<BillingWebhookSubscriptionRepository, "findByStripeId">;
  organizations: Pick<
    BillingAccountFactsRepository,
    "findWithAdministrators" | "findMemberEmails" | "findName"
  >;
  /** Who holds the Billing role; absent where no authorization is composed, then admins only. */
  billingMembers?: Pick<AuthzApi, "listBillingMembers">;
  invoices: Pick<StripeInvoicesChannel, "getInvoice">;
  emails: PaymentRecoveryEmailChannel;
  alerts: Pick<BillingWebhookHost, "sendSlackAccountPaymentFailed">;
  publicBaseUrl: string;
  /** Marks an organization paused into Free with too many members; absent, none is marked. */
  overPlan?: Pick<OverPlanService, "downgraded">;
  now?: () => Instant;
};

export class PaymentRecoveryService {
  static create(options: PaymentRecoveryOptions): PaymentRecoveryService {
    return new PaymentRecoveryService(options);
  }

  private readonly options: PaymentRecoveryOptions;
  private readonly now: () => Instant;
  private readonly mail: PaymentRecoveryMailService;

  private constructor(options: PaymentRecoveryOptions) {
    this.options = options;
    this.now = options.now ?? nowInstant;
    this.mail = PaymentRecoveryMailService.create({
      organizations: options.organizations,
      ...(options.billingMembers ? { billingMembers: options.billingMembers } : {}),
      emails: options.emails,
      publicBaseUrl: options.publicBaseUrl,
    });
  }

  /** A failed charge opens the case for a card-collected renewal; the first email waits for day 3. */
  async paymentFailed({ invoice }: { invoice: RecoveryInvoice }): Promise<void> {
    if (!invoice.subscriptionId) return;
    if (invoice.collectionMethod !== "charge_automatically") return;
    if (!invoice.billingReason || !RECOVERABLE_BILLING_REASONS.has(invoice.billingReason)) return;

    const subscription = await this.options.subscriptions.findByStripeId(invoice.subscriptionId);
    if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE) {
      logger.info(
        { invoiceId: invoice.id },
        "Payment failure is not for an active subscription; no recovery case",
      );
      return;
    }

    if (subscription.plan === PlanTypes.ENTERPRISE) {
      await this.alertAccountTeam({ organizationId: subscription.organizationId, invoice });
      return;
    }

    const opened = await this.options.recoveries.open({
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      startedAt: this.now(),
    });
    if (!opened) return;
    logger.info(
      { organizationId: subscription.organizationId, invoiceId: invoice.id },
      "Payment recovery case opened",
    );
  }

  /**
   * A paid invoice closes its case; the closing write alone sends the restored email, and only
   * when an email about the failure went out first.
   */
  async invoicePaid({ invoice }: { invoice: RecoveryInvoice }): Promise<void> {
    const subscription = invoice.subscriptionId
      ? await this.options.subscriptions.findByStripeId(invoice.subscriptionId)
      : null;
    if (!subscription) return;
    const [open] = await this.options.recoveries.findOpenForSubscription(subscription.id);
    if (!open || open.invoiceId !== invoice.id) return;
    const restored = await this.restoredMails({ open, fallback: invoice });
    const result = await this.options.recoveries.close({
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
    });
    if (result.outcome !== "closed") return;
    logger.info(
      { organizationId: result.closed.organizationId, invoiceId: invoice.id },
      "Payment recovery case closed by payment",
    );
    for (const mail of restored) await this.mail.deliver(mail);
  }

  /** Voided or marked uncollectible by staff: the case closes, the plan stays, nothing is mailed. */
  async invoiceClosedUnpaid({ invoice }: { invoice: RecoveryInvoice }): Promise<void> {
    const subscription = invoice.subscriptionId
      ? await this.options.subscriptions.findByStripeId(invoice.subscriptionId)
      : null;
    if (!subscription) return;
    await this.options.recoveries.close({ subscriptionId: subscription.id, invoiceId: invoice.id });
  }

  /** Each open case's latest notice due; the notice day moves before the mail goes. */
  async sweep(): Promise<PaymentRecoverySweepOutcome> {
    const outcome: PaymentRecoverySweepOutcome = { notified: 0, closed: 0, failed: 0 };
    for (const open of await this.options.recoveries.findOpen()) {
      try {
        const result = await this.sweepCase(open);
        if (result === "notified") outcome.notified++;
        if (result === "closed") outcome.closed++;
      } catch (error) {
        outcome.failed++;
        logger.warn(
          {
            organizationId: open.organizationId,
            subscriptionId: open.subscriptionId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Payment recovery sweep could not handle a case; the next sweep retries it",
        );
      }
    }
    return outcome;
  }

  /** What every member may read. */
  async summary({ organizationId }: { organizationId: string }): Promise<PaymentRecoverySummary> {
    const [open] = await this.options.recoveries.findOpenForOrganization(organizationId);
    return { state: open ? this.stateOf(open) : "none" };
  }

  /** The open case with its invoice, for people who manage the subscription. */
  async details({ organizationId }: { organizationId: string }): Promise<PaymentRecoveryDetails> {
    const [open] = await this.options.recoveries.findOpenForOrganization(organizationId);
    if (!open) {
      return {
        state: "none",
        startedAt: null,
        accessStopsAt: null,
        invoiceNumber: null,
        amountDue: null,
        currency: null,
        card: null,
      };
    }
    const invoice = await this.options.invoices
      .getInvoice({ invoiceId: open.invoiceId })
      .catch((error: unknown) => {
        logger.warn(
          { organizationId, error: error instanceof Error ? error.message : String(error) },
          "Could not read the recovery case's invoice; answering without its amount",
        );
        return undefined;
      });
    return {
      state: this.stateOf(open),
      startedAt: open.startedAt.toString(),
      accessStopsAt: accessStopsAt({ startedAt: open.startedAt }).toString(),
      invoiceNumber: invoice?.number ?? null,
      amountDue: invoice?.amountDue ?? null,
      currency: invoice?.currency ?? null,
      card: invoice?.card ?? null,
    };
  }

  /** Stripe's page for the open invoice; the billing page when there is none or it cannot be read. */
  async payLink({ organizationId }: { organizationId: string }): Promise<PaymentRecoveryPayLink> {
    const billingPage = `${this.options.publicBaseUrl}/settings/subscription`;
    const [open] = await this.options.recoveries.findOpenForOrganization(organizationId);
    if (!open) return { url: billingPage, isFallback: true };
    try {
      const invoice = await this.options.invoices.getInvoice({ invoiceId: open.invoiceId });
      if (invoice.hostedUrl) return { url: invoice.hostedUrl, isFallback: false };
    } catch (error) {
      logger.error(
        { organizationId, error: error instanceof Error ? error.message : String(error) },
        "Could not read the open invoice's payment page; sending the billing page instead",
      );
    }
    return { url: billingPage, isFallback: true };
  }

  private stateOf(open: PaymentRecoveryCase): "failing" | "paused" {
    return isPlanPausedForRecovery({ ...open, now: this.now() }) ? "paused" : "failing";
  }

  /** Stripe's answer is read on every sweep, so a paused case whose paid event was lost still closes. */
  private async sweepCase(open: PaymentRecoveryCase): Promise<"notified" | "closed" | "none"> {
    const invoice = await this.options.invoices.getInvoice({ invoiceId: open.invoiceId });
    if (invoice.status === "paid") {
      const restored = await this.restoredMails({ open, invoice });
      const result = await this.options.recoveries.close({
        subscriptionId: open.subscriptionId,
        invoiceId: open.invoiceId,
      });
      if (result.outcome !== "closed") return "none";
      logger.info(
        { organizationId: open.organizationId, invoiceId: open.invoiceId },
        "Payment recovery case closed by a sweep that found the invoice paid",
      );
      for (const mail of restored) await this.mail.deliver(mail);
      return "closed";
    }
    if (invoice.status === "void" || invoice.status === "uncollectible") {
      await this.options.recoveries.close({
        subscriptionId: open.subscriptionId,
        invoiceId: open.invoiceId,
      });
      return "closed";
    }
    const due = dueNotice({ ...open, now: this.now() });
    if (due.kind === "none") return "none";
    return (await this.sendNotice({ open, day: due.day, invoice })) ? "notified" : "none";
  }

  /**
   * Reads the recipients first, so a failed lookup leaves the notice day unmoved for the next
   * sweep; then moves the notice day and mails. False when another sweep sent it.
   */
  private async sendNotice({
    open,
    day,
    invoice,
  }: {
    open: PaymentRecoveryCase;
    day: PaymentRecoveryNoticeDay;
    invoice: BillingInvoiceDetail;
  }): Promise<boolean> {
    const kind = noticeKindOf(day);
    const mail = await this.mail.prepare({ kind, open, invoice });
    const advanced = await this.options.recoveries.advanceNotice({
      subscriptionId: open.subscriptionId,
      from: open.noticeDay,
      to: day,
    });
    if (!advanced) return false;
    if (kind === "paused") await this.markIfOverPlan(open);
    await this.mail.deliver(mail);
    logger.info({ organizationId: open.organizationId, day, kind }, "Payment recovery notice sent");
    return true;
  }

  /** Day 21 into Free with too many members withholds traces from day 21; a failure only logs. */
  private async markIfOverPlan(open: PaymentRecoveryCase): Promise<void> {
    try {
      await this.options.overPlan?.downgraded({
        organizationId: open.organizationId,
        subscriptionId: open.subscriptionId,
        since: accessStopsAt({ startedAt: open.startedAt }),
        reason: "payment_recovery",
      });
    } catch (error) {
      logger.error(
        {
          organizationId: open.organizationId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not record the over-plan mark at day 21; new traces stay visible",
      );
    }
  }

  /**
   * The restored email, ready before the case closes so the closing write never loses it; none
   * for a case that closed before its first email.
   */
  private async restoredMails({
    open,
    invoice,
    fallback,
  }: {
    open: PaymentRecoveryCase;
    invoice?: BillingInvoiceDetail;
    fallback?: RecoveryInvoice;
  }): Promise<PreparedMail[]> {
    if (open.noticeDay === null) return [];
    const read = invoice ?? (await this.readInvoice({ invoiceId: open.invoiceId, fallback }));
    return [await this.mail.prepare({ kind: "restored", open, invoice: read })];
  }

  /** The invoice as Stripe answers it now, else the webhook's copy without the card. */
  private async readInvoice({
    invoiceId,
    fallback,
  }: {
    invoiceId: string;
    fallback?: RecoveryInvoice;
  }): Promise<BillingInvoiceDetail> {
    try {
      return await this.options.invoices.getInvoice({ invoiceId });
    } catch (error) {
      if (!fallback) throw error;
      return {
        id: fallback.id,
        customerId: null,
        number: fallback.number,
        created: fallback.created,
        amountDue: fallback.amountDue,
        currency: fallback.currency,
        status: null,
        pdfUrl: null,
        hostedUrl: null,
        card: null,
      };
    }
  }

  private async alertAccountTeam({
    organizationId,
    invoice,
  }: {
    organizationId: string;
    invoice: RecoveryInvoice;
  }): Promise<void> {
    const organization = await this.options.organizations.findName(organizationId);
    await this.options.alerts.sendSlackAccountPaymentFailed({
      organizationId,
      organizationName: organization?.name ?? "Unknown",
      stripeInvoiceId: invoice.id,
      amount: this.mail.amountOf({ amount: invoice.amountDue, currency: invoice.currency }),
    });
  }
}
