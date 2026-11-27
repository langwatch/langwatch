/**
 * The billing ops functions (ADR-202): read through billing's own API, so no card, invoice
 * link, customer name or Stripe key leaves it. Each refuses off LangWatch Cloud by name.
 * Spec: modules/staff-access/specs/staff-access-functions-billing.feature
 */
import { z } from "zod";

import {
  countsByCode,
  entry,
  isoTime,
  pageInput,
  rangeInput,
  staffAccessPageSchema,
  type StaffAccessFunctionEntry,
} from "./staff-access-function-shapes.ts";

const subscriptionState = z.enum(["pending", "failed", "active", "cancelled", "other"]);

export const STAFF_ACCESS_BILLING_FUNCTIONS = {
  "org.billing": entry({
    title: "Plan, subscription state, seats, failed payments and over-plan state",
    scope: "org",
    answers:
      "Whether the organization pays, on which plan, whether it cancelled or a payment is failing.",
    input: z.object({}).strict(),
    output: z
      .object({
        organizationId: z.string(),
        pricingModel: z.enum(["tiered", "seat_event", "none"]),
        /** The subscription billed under now; `none` and null ids when it never subscribed. */
        subscriptionId: z.string().nullable(),
        plan: z.string(),
        state: z.union([subscriptionState, z.literal("none")]),
        createdAt: isoTime.nullable(),
        startedAt: isoTime.nullable(),
        endedAt: isoTime.nullable(),
        lastPaymentFailedAt: isoTime.nullable(),
        pastDue: z.boolean(),
        paymentRecoveryStartedAt: isoTime.nullable(),
        paymentRecoveryNoticeDay: z.number().int().nullable(),
        linkedToStripe: z.boolean(),
        fullSeats: z.number().int().nullable(),
        liteSeats: z.number().int().nullable(),
        developerSeats: z.number().int().nullable(),
        eventsCap: z.number().int().nullable(),
        retentionDays: z.number().int().nullable(),
        seatsKept: z.number().int().nullable(),
        seatsKeptUntil: isoTime.nullable(),
        subscriptionsByState: countsByCode,
        lastCancelledAt: isoTime.nullable(),
        overPlanSince: isoTime.nullable(),
      })
      .strict(),
  }),
  "billing.subscriptions": entry({
    title: "Subscriptions created in a range, per plan and state",
    scope: "platform",
    answers: "How many organizations opened a checkout, how many completed it, and on which plans.",
    input: z.object({ ...rangeInput, ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          plan: z.string(),
          state: subscriptionState,
          subscriptions: z.number().int(),
          activated: z.number().int(),
          organizations: z.number().int(),
        })
        .strict(),
    ),
  }),
  "billing.stripe_prices": entry({
    title: "The Stripe price catalogue with tax behaviour",
    scope: "platform",
    answers: "Which Stripe prices exist, whether they are active, and how tax applies to each.",
    input: z.object({ ...pageInput }).strict(),
    output: staffAccessPageSchema(
      z
        .object({
          priceId: z.string(),
          catalogueName: z.string(),
          currency: z.string(),
          unitAmount: z.number().int().nullable(),
          interval: z.enum(["day", "week", "month", "year"]).nullable(),
          intervalCount: z.number().int().nullable(),
          taxBehavior: z.enum(["exclusive", "inclusive", "unspecified", "other"]).nullable(),
          active: z.boolean(),
          livemode: z.boolean(),
        })
        .strict(),
    ),
  }),
} as const satisfies Record<string, StaffAccessFunctionEntry>;
