import type { Named } from "@langwatch/module";
/**
 * What the browser reads about a failed payment recovery case
 * (enterprise/modules/billing/specs/payment-recovery.feature).
 */
import { z } from "zod";

/** none: nothing unpaid; failing: day 0 to 20; paused: day 21 on, Free plan limits apply. */
export const paymentRecoveryStateSchema = z.enum(["none", "failing", "paused"]);
export type PaymentRecoveryState = z.infer<typeof paymentRecoveryStateSchema>;

/** What every member may read: whether the organization is failing or paused. */
const paymentRecoverySummarySchemaDefinition = z.object({ state: paymentRecoveryStateSchema });
export interface PaymentRecoverySummarySchema extends Named<
  typeof paymentRecoverySummarySchemaDefinition
> {}
export const paymentRecoverySummarySchema: PaymentRecoverySummarySchema =
  paymentRecoverySummarySchemaDefinition;
export type PaymentRecoverySummary = z.infer<typeof paymentRecoverySummarySchema>;

/** What people who manage the subscription read: the invoice, its amount and the Free plan date. */
const paymentRecoveryDetailsSchemaDefinition = z.object({
  state: paymentRecoveryStateSchema,
  /** ISO instant of day 0, the first failed charge. */
  startedAt: z.string().nullable(),
  /** ISO instant the organization moves to the Free plan: day 0 plus 21 days. */
  accessStopsAt: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  /** The invoice total including VAT, in the currency's minor unit. */
  amountDue: z.number().int().nullable(),
  currency: z.string().nullable(),
  /** The card the failed charge tried, when Stripe names one. */
  card: z.object({ brand: z.string(), last4: z.string() }).nullable(),
});
export interface PaymentRecoveryDetailsSchema extends Named<
  typeof paymentRecoveryDetailsSchemaDefinition
> {}
export const paymentRecoveryDetailsSchema: PaymentRecoveryDetailsSchema =
  paymentRecoveryDetailsSchemaDefinition;
export type PaymentRecoveryDetails = z.infer<typeof paymentRecoveryDetailsSchema>;

/** Where the pay button goes: Stripe's page for the open invoice, or the billing page. */
const paymentRecoveryPayLinkSchemaDefinition = z.object({
  url: z.string(),
  /** True when Stripe's invoice page could not be read and the billing page stands in. */
  isFallback: z.boolean(),
});
export interface PaymentRecoveryPayLinkSchema extends Named<
  typeof paymentRecoveryPayLinkSchemaDefinition
> {}
export const paymentRecoveryPayLinkSchema: PaymentRecoveryPayLinkSchema =
  paymentRecoveryPayLinkSchemaDefinition;
export type PaymentRecoveryPayLink = z.infer<typeof paymentRecoveryPayLinkSchema>;
