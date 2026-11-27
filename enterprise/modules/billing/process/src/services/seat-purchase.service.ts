// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  SeatBillingUnavailableError,
  SeatChangeBusyError,
  SeatPaymentUnavailableError,
  type SeatOffer,
  type SeatPayment,
  type SeatPaymentStatus,
  type SeatPurchase,
} from "@langwatch/enterprise-billing-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { StripeInvoicesChannel } from "../channels/stripe-invoices.channel.ts";
import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type { SeatEventSubscriptionRepository } from "../repositories/seat-event-subscription.repository.ts";
import { resolveProrationDate, seatChange } from "../rules/seat-event-quote.rules.ts";
import type { SeatEventSubscriptionService } from "./seat-event-subscription.service.ts";
import {
  SEAT_LINE_WRITE_TIMEOUT_MS,
  type SeatLineGuard,
  SeatLineLeaseService,
} from "./seat-line-lease.service.ts";

const logger = createLogger("langwatch:billing:seatPurchase");

/** How long a seat purchase waits for another change or a repair on the same subscription. */
const SEAT_PURCHASE_WAIT_MS = 15_000;

type SeatChanges = Pick<
  SeatEventSubscriptionService,
  "seatChangeTarget" | "seatChangePlan" | "previewProration" | "updateSeatEventItems"
>;

/** Opens the seat checkout an operator-added plan buys its seats through. */
export type SeatCheckoutOpener = (input: {
  organizationId: string;
  baseUrl: string;
  successPath: string;
  membersToAdd: number;
  customerEmail: string | null;
}) => Promise<{ url: string | null; subscriptionId: string }>;

type SeatPurchaseDependencies = {
  seats: SeatChanges;
  stripeSubscriptions: Pick<StripeSubscriptionsChannel, "updateSubscription">;
  stripeInvoices: Pick<StripeInvoicesChannel, "getInvoice" | "voidInvoice">;
  subscriptions: SeatEventSubscriptionRepository;
  pricingModel: (organizationId: string) => Promise<string | null>;
  openCheckout: SeatCheckoutOpener;
};

/** Whether `error` is the refusal named `code`. */
function isRefusal(error: unknown, code: string): boolean {
  return HandledError.isHandled(error) && error.code === code;
}

/**
 * One full seat bought for a role change (specs/licensing/role-change-seat.feature). The charge
 * goes to the subscription's payment method and waits for payment when the customer must act;
 * Stripe keeps the line unchanged until that invoice is paid, so an unpaid one changes nothing.
 */
export class SeatPurchaseService {
  private readonly lease: SeatLineLeaseService;

  private constructor(private readonly dependencies: SeatPurchaseDependencies) {
    this.lease = SeatLineLeaseService.create({ subscriptions: dependencies.subscriptions });
  }

  static create(dependencies: SeatPurchaseDependencies): SeatPurchaseService {
    return new SeatPurchaseService(dependencies);
  }

  async offer({ organizationId }: { organizationId: string }): Promise<SeatOffer> {
    if ((await this.dependencies.pricingModel(organizationId)) !== "SEAT_EVENT") {
      return { kind: "none" };
    }
    let billed: number;
    let renewsAt: number | null;
    try {
      const target = await this.dependencies.seats.seatChangeTarget(organizationId);
      billed = billedSeats(target);
      const periodEnd = target.stripeSubscription.currentPeriodEnd;
      renewsAt = periodEnd == null ? null : periodEnd * 1000;
    } catch (error) {
      return this.offerOnRefusal({ organizationId, error });
    }
    const newTotalSeats = billed + 1;
    const quote = await this.dependencies.seats.previewProration({
      organizationId,
      newTotalSeats,
    });
    return {
      kind: "charge",
      newTotalSeats,
      formattedSeatPrice: quote.formattedSeatPrice,
      formattedAmountDue: quote.formattedAmountDue,
      formattedRecurringTotal: quote.formattedRecurringTotal,
      billingInterval: quote.billingInterval,
      renewsAt,
      quotedAt: quote.quotedAt,
    };
  }

  private async offerOnRefusal({
    organizationId,
    error,
  }: {
    organizationId: string;
    error: unknown;
  }): Promise<SeatOffer> {
    if (isRefusal(error, "seat_checkout_required")) {
      return { kind: "checkout", newTotalSeats: (await this.localSeats(organizationId)) + 1 };
    }
    if (isRefusal(error, "subscription_ambiguous")) return { kind: "blocked" };
    if (isRefusal(error, "seat_change_needs_support")) return { kind: "support" };
    if (isRefusal(error, "subscription_sync_failed")) return { kind: "none" };
    throw error;
  }

  async addFullSeat(input: {
    organizationId: string;
    quotedAt?: number;
    baseUrl: string;
    successPath: string;
    customerEmail: string | null;
  }): Promise<SeatPurchase> {
    const { organizationId, quotedAt } = input;
    if ((await this.dependencies.pricingModel(organizationId)) !== "SEAT_EVENT") {
      throw new SeatBillingUnavailableError();
    }
    let target: SeatChangeTarget;
    try {
      target = await this.dependencies.seats.seatChangeTarget(organizationId, { heal: true });
    } catch (error) {
      if (!isRefusal(error, "seat_checkout_required")) throw error;
      return this.buyThroughCheckout(input);
    }
    if (target.stripeSubscription.pendingUpdate) return this.waitingPayment(target);

    const requested = billedSeats(target) + 1;
    const plan = this.dependencies.seats.seatChangePlan({ target, requested });
    const [step] = plan.steps;
    const chargedNow = plan.steps.length === 1 && step?.prorationBehavior === "always_invoice";
    // Kept seats or a lift: nothing new is charged for this seat, so the usual change applies.
    if (!chargedNow || plan.kept) {
      await this.dependencies.seats.updateSeatEventItems({
        organizationId,
        totalMembers: requested,
        ...(quotedAt === undefined ? {} : { quotedAt }),
      });
      return { status: "added" };
    }
    return this.charge({ organizationId, leased: target.subscription.id, quotedAt });
  }

  /**
   * Raises the line by one, invoiced now; Stripe holds it until paid when the customer must act.
   * The target is read again under the seat line lease, so two purchases at once buy two seats.
   */
  private async charge({
    organizationId,
    leased,
    quotedAt,
  }: {
    organizationId: string;
    leased: string;
    quotedAt: number | undefined;
  }): Promise<SeatPurchase> {
    const prorationDate = resolveProrationDate(quotedAt);
    const held = await this.lease.hold({
      id: leased,
      waitMs: SEAT_PURCHASE_WAIT_MS,
      work: (guard) => this.chargeHeld({ organizationId, leased, prorationDate, guard }),
    });
    if (!held.held) throw new SeatChangeBusyError();
    return held.value;
  }

  private async chargeHeld({
    organizationId,
    leased,
    prorationDate,
    guard,
  }: {
    organizationId: string;
    leased: string;
    prorationDate: number;
    guard: SeatLineGuard;
  }): Promise<SeatPurchase> {
    const target = await this.dependencies.seats.seatChangeTarget(organizationId, { heal: true });
    if (target.subscription.id !== leased) throw new SeatChangeBusyError();
    if (target.stripeSubscription.pendingUpdate) return this.waitingPayment(target);
    const { subscription, stripeSubscription, seatItem } = target;
    const requested = billedSeats(target) + 1;
    const updated = await guard.write({
      quantity: requested,
      send: () =>
        this.dependencies.stripeSubscriptions.updateSubscription({
          subscriptionId: stripeSubscription.id,
          change: {
            ...seatChange({
              subscription: stripeSubscription,
              seatItem,
              quantity: requested,
              prorationDate,
            }),
            paymentBehavior: "pending_if_incomplete",
          },
          timeoutMs: SEAT_LINE_WRITE_TIMEOUT_MS,
        }),
    });

    const invoice = updated.latestInvoice;
    if (updated.pendingUpdate) {
      if (!invoice?.hostedUrl) {
        // Nothing to pay it on: voiding the invoice drops the held change with it.
        if (invoice) await this.dependencies.stripeInvoices.voidInvoice({ invoiceId: invoice.id });
        throw new SeatPaymentUnavailableError();
      }
      logger.info({ organizationId, invoiceId: invoice.id }, "seat purchase waits for payment");
      return {
        status: "payment_required",
        payment: { kind: "invoice", invoiceId: invoice.id, seats: requested },
        url: invoice.hostedUrl,
      };
    }
    await this.dependencies.subscriptions.reactivateWithSeats({
      id: subscription.id,
      maxMembers: requested,
      kept: null,
      repairsUpTo: nowInstant(),
    });
    return { status: "added" };
  }

  /** A seat change Stripe already holds for payment: its invoice, never a second one. */
  private async waitingPayment(target: SeatChangeTarget): Promise<SeatPurchase> {
    const invoiceId = target.stripeSubscription.latestInvoice?.id;
    if (!invoiceId) throw new SeatPaymentUnavailableError();
    const invoice = await this.dependencies.stripeInvoices.getInvoice({ invoiceId });
    if (invoice.status !== "open" || !invoice.hostedUrl) throw new SeatPaymentUnavailableError();
    return {
      status: "payment_required",
      payment: { kind: "invoice", invoiceId, seats: billedSeats(target) + 1 },
      url: invoice.hostedUrl,
    };
  }

  private async buyThroughCheckout(input: {
    organizationId: string;
    baseUrl: string;
    successPath: string;
    customerEmail: string | null;
  }): Promise<SeatPurchase> {
    const membersToAdd = (await this.localSeats(input.organizationId)) + 1;
    const { url, subscriptionId } = await this.dependencies.openCheckout({
      ...input,
      membersToAdd,
    });
    if (!url) throw new SeatPaymentUnavailableError();
    return { status: "payment_required", payment: { kind: "checkout", subscriptionId }, url };
  }

  /** The full seats the operator-added plan grants, from billing's own row. */
  private async localSeats(organizationId: string): Promise<number> {
    const rows = await this.dependencies.subscriptions.findSeatCandidates({ organizationId });
    const local = rows.find((row) => row.status === "ACTIVE" && row.stripeSubscriptionId === null);
    return local?.maxMembers ?? 0;
  }

  async settle({
    organizationId,
    payment,
  }: {
    organizationId: string;
    payment: SeatPayment;
  }): Promise<{ status: SeatPaymentStatus }> {
    return payment.kind === "invoice"
      ? this.settleInvoice({ organizationId, invoiceId: payment.invoiceId, seats: payment.seats })
      : this.settleCheckout({ organizationId, subscriptionId: payment.subscriptionId });
  }

  /**
   * Paid only once the seat line bills the seats the invoice was for. An open invoice whose held
   * change Stripe dropped (expired) can no longer add the seat, so it is voided and failed.
   */
  private async settleInvoice({
    organizationId,
    invoiceId,
    seats,
  }: {
    organizationId: string;
    invoiceId: string;
    seats: number;
  }): Promise<{ status: SeatPaymentStatus }> {
    const invoice = await this.dependencies.stripeInvoices.getInvoice({ invoiceId });
    const { subscription, stripeSubscription, seatItem } =
      await this.dependencies.seats.seatChangeTarget(organizationId);
    // Another customer's invoice settles nothing here.
    if (!invoice.customerId || invoice.customerId !== stripeSubscription.customerId) {
      return { status: "failed" };
    }
    if (invoice.status === "void" || invoice.status === "uncollectible") {
      return { status: "failed" };
    }
    const billed = seatItem.quantity ?? 0;
    if (invoice.status !== "paid") {
      if (stripeSubscription.pendingUpdate) return { status: "open" };
      await this.dependencies.stripeInvoices.voidInvoice({ invoiceId });
      return { status: "failed" };
    }
    if (billed < seats) {
      logger.error(
        { organizationId, invoiceId, seats, billed },
        "a seat invoice was paid but the seat line never rose; it needs a refund",
      );
      return { status: "failed" };
    }

    if (billed > (subscription.maxMembers ?? 0)) {
      await this.dependencies.subscriptions.reactivateWithSeats({
        id: subscription.id,
        maxMembers: billed,
        kept: null,
        repairsUpTo: nowInstant(),
      });
    }
    return { status: "paid" };
  }

  /**
   * A seat checkout row turns ACTIVE once paid. One the operator-added plan adopted is cancelled,
   * so it answers open: billing's seat-checkout-paid fact is what proves that one was paid.
   */
  private async settleCheckout({
    organizationId,
    subscriptionId,
  }: {
    organizationId: string;
    subscriptionId: string;
  }): Promise<{ status: SeatPaymentStatus }> {
    const rows = await this.dependencies.subscriptions.findSeatCandidates({ organizationId });
    const row = rows.find((each) => each.id === subscriptionId);
    return { status: row?.status === "ACTIVE" ? "paid" : "open" };
  }
}

type SeatChangeTarget = Awaited<ReturnType<SeatChanges["seatChangeTarget"]>>;

function billedSeats(target: SeatChangeTarget): number {
  return target.seatItem.quantity ?? target.subscription.maxMembers ?? 0;
}
