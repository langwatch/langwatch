import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant } from "@langwatch/time";

import type { StripeSubscriptionsChannel } from "../channels/stripe-subscriptions.channel.ts";
import type {
  SeatEventSubscriptionRepository,
  SeatRepairRecord,
} from "../repositories/seat-event-subscription.repository.ts";
import type {
  BillingSubscription,
  BillingSubscriptionItem,
} from "../rules/billing-stripe-shapes.rules.ts";
import { seatChange } from "../rules/seat-event-quote.rules.ts";
import type { SeatChangePlan } from "../rules/seat-kept.rules.ts";
import {
  SEAT_LINE_WRITE_TIMEOUT_MS,
  type SeatLineGuard,
  SeatLineLeaseLostError,
} from "./seat-line-lease.service.ts";

const logger = createLogger("langwatch:billing:seatLineMove");

type SeatLineWrites = Pick<StripeSubscriptionsChannel, "getSubscription" | "updateSubscription">;

/**
 * Sends a seat change plan's steps to Stripe. A plan that lifts the line first records the way
 * back before the lift, so a change that stops halfway leaves a repair for the seat line repair
 * (specs/licensing/seat-rotation.feature); a refused charge after the lift puts the line back.
 */
export class SeatLineMoveService {
  private constructor(
    private readonly stripeSubscriptions: SeatLineWrites,
    private readonly subscriptions: SeatEventSubscriptionRepository,
  ) {}

  static create({
    stripeSubscriptions,
    subscriptions,
  }: {
    stripeSubscriptions: SeatLineWrites;
    subscriptions: SeatEventSubscriptionRepository;
  }): SeatLineMoveService {
    return new SeatLineMoveService(stripeSubscriptions, subscriptions);
  }

  /**
   * Moves the line through every step; throws the first refusal. Answers the instant up to which
   * recorded repairs are settled once the change is recorded as done.
   */
  async move({
    id,
    organizationId,
    stripeSubscription,
    seatItem,
    billed,
    plan,
    prorationDate,
    guard,
  }: {
    id: string;
    organizationId: string;
    stripeSubscription: BillingSubscription;
    seatItem: BillingSubscriptionItem;
    billed: number;
    plan: SeatChangePlan;
    prorationDate: number;
    guard: SeatLineGuard;
  }): Promise<{ repairsUpTo: Instant }> {
    const startedAt = nowInstant();
    const [first] = plan.steps;
    const lift = plan.steps.length > 1 && first?.prorationBehavior === "none" ? first : null;
    // Recorded before Stripe is touched: when this write fails, the change stops here.
    const record = lift
      ? await this.subscriptions.recordSeatRepair({
          id,
          quantity: billed,
          liftedQuantity: lift.quantity,
        })
      : null;
    const subscriptionId = stripeSubscription.id;
    const moveTo = (quantity: number, prorationBehavior: "always_invoice" | "none") =>
      guard.write({
        quantity,
        send: () =>
          this.stripeSubscriptions.updateSubscription({
            subscriptionId,
            change: seatChange({
              subscription: stripeSubscription,
              seatItem,
              quantity,
              prorationDate,
              prorationBehavior,
            }),
            timeoutMs: SEAT_LINE_WRITE_TIMEOUT_MS,
          }),
      });

    let lifted = false;
    try {
      for (const step of plan.steps) {
        await moveTo(step.quantity, step.prorationBehavior);
        lifted = step === lift;
      }
    } catch (error) {
      // A lost lease belongs to the newer holder now; the recorded repair re-checks the line.
      const leaseLost = error instanceof SeatLineLeaseLostError;
      if (lifted && record && !leaseLost)
        await this.rollBack({ id, organizationId, record, moveTo });
      throw error;
    }
    return { repairsUpTo: record?.since ?? startedAt };
  }

  /** Puts a lifted line back after a refused charge; the record stays if Stripe refuses it. */
  private async rollBack({
    id,
    organizationId,
    record,
    moveTo,
  }: {
    id: string;
    organizationId: string;
    record: SeatRepairRecord;
    moveTo: (quantity: number, prorationBehavior: "none") => Promise<unknown>;
  }): Promise<void> {
    try {
      await moveTo(record.quantity, "none");
    } catch (rollbackError) {
      logger.error(
        { error: rollbackError, organizationId, subscriptionId: id, billedBefore: record.quantity },
        "seat line left lifted: the charge and putting the line back both failed; repair recorded",
      );
      return;
    }
    await this.subscriptions.clearSeatRepair({ id, record }).catch((clearError: unknown) => {
      // Stripe already bills the recorded quantity, so the repair pass clears it untouched.
      logger.warn({ error: clearError, organizationId }, "seat repair left after a rollback");
    });
  }
}
