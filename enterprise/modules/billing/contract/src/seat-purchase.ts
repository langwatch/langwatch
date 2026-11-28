// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * One full seat bought for a role change (specs/licensing/role-change-seat.feature): the offer
 * the member drawer shows, the purchase, and the payment a purchase may still wait on.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The payment a seat purchase waits on: a seat invoice to pay, or a seat checkout to finish. */
const seatPaymentSchemaDefinition = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("invoice"),
      invoiceId: z.string().min(1),
      /** The full seats the line bills once the invoice is paid. */
      seats: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("checkout"), subscriptionId: z.string().min(1) }).strict(),
]);
export interface SeatPaymentSchema extends Named<typeof seatPaymentSchemaDefinition> {}
export const seatPaymentSchema: SeatPaymentSchema = seatPaymentSchemaDefinition;
export type SeatPayment = z.infer<typeof seatPaymentSchema>;

/** Added and paid at once, or a payment page the customer finishes first. */
export type SeatPurchase =
  | Readonly<{ status: "added" }>
  | Readonly<{ status: "payment_required"; payment: SeatPayment; url: string }>;

/** Where a payment stands: paid, still payable, or over with nothing charged. */
export const seatPaymentStatusSchema = z.enum(["paid", "open", "failed"]);
export type SeatPaymentStatus = z.infer<typeof seatPaymentStatusSchema>;

/**
 * What one more full seat costs. `none`: no paid seat plan to add to (the upgrade path applies);
 * `charge`: added to the live subscription; `checkout`: bought through checkout;
 * `blocked`: billing is held on our side and nothing can be bought until it is fixed.
 */
const seatOfferSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("charge"),
      newTotalSeats: z.number().int().positive(),
      formattedSeatPrice: z.string(),
      formattedAmountDue: z.string(),
      formattedRecurringTotal: z.string(),
      billingInterval: z.string(),
      /** Epoch milliseconds the next period starts; null when the provider names none. */
      renewsAt: z.number().int().nullable(),
      /** Sent back with the purchase so the charge prices the instant quoted. */
      quotedAt: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("checkout"), newTotalSeats: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("blocked") }).strict(),
  z.object({ kind: z.literal("support") }).strict(),
]);
export interface SeatOfferSchema extends Named<typeof seatOfferSchemaDefinition> {}
export const seatOfferSchema: SeatOfferSchema = seatOfferSchemaDefinition;
export type SeatOffer = z.infer<typeof seatOfferSchema>;

/** "an Admin", "a Member", "a Lite Member": a seat role label with its article. */
export function withArticle(label: string): string {
  return `${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}`;
}
