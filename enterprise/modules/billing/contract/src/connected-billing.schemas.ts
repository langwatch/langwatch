// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Invoice billing for a connected customer as the admin console reads and writes
 * it (ADR-156 section 7). Instants travel as ISO strings: tRPC carries no transformer.
 */

import type { Named } from "@langwatch/module";
import { z } from "zod";

const currencySchema = z.enum(["USD", "EUR"]);
const isoInstantSchema = z.iso.datetime({ offset: true });

/** The customer organization being billed; never the caller's own reach. */
const connectedCustomerInputSchemaDefinition = z.object({ organizationId: z.string().min(1) });
export interface ConnectedCustomerInputSchema extends Named<
  typeof connectedCustomerInputSchemaDefinition
> {}
export const connectedCustomerInputSchema: ConnectedCustomerInputSchema =
  connectedCustomerInputSchemaDefinition;

const contractTermsInput = {
  termStartsAt: isoInstantSchema,
  termEndsAt: isoInstantSchema,
  seats: z.number().int().positive(),
  seatRateCents: z.number().int().min(0),
  seatCurrency: currencySchema,
  commitUsdCents: z.number().int().min(0),
};

const connectedOnboardRequestSchemaDefinition = z.object({
  ...connectedCustomerInputSchema.shape,
  organizationName: z.string().trim().min(1).max(200),
  billingEmail: z.email(),
  bankTransfer: z
    .object({
      type: z.enum(["us_bank_transfer", "eu_bank_transfer"]),
      country: z.string().length(2).optional(),
    })
    .nullable()
    .default(null),
  ...contractTermsInput,
});
export interface ConnectedOnboardRequestSchema extends Named<
  typeof connectedOnboardRequestSchemaDefinition
> {}
export const connectedOnboardRequestSchema: ConnectedOnboardRequestSchema =
  connectedOnboardRequestSchemaDefinition;
export type ConnectedOnboardRequest = z.infer<typeof connectedOnboardRequestSchema>;

const connectedRenewRequestSchemaDefinition = z.object({
  ...connectedCustomerInputSchema.shape,
  ...contractTermsInput,
});
export interface ConnectedRenewRequestSchema extends Named<
  typeof connectedRenewRequestSchemaDefinition
> {}
export const connectedRenewRequestSchema: ConnectedRenewRequestSchema =
  connectedRenewRequestSchemaDefinition;
export type ConnectedRenewRequest = z.infer<typeof connectedRenewRequestSchema>;

const connectedAddCommitRequestSchemaDefinition = z.object({
  ...connectedCustomerInputSchema.shape,
  amountUsdCents: z.number().int().positive(),
});
export interface ConnectedAddCommitRequestSchema extends Named<
  typeof connectedAddCommitRequestSchemaDefinition
> {}
export const connectedAddCommitRequestSchema: ConnectedAddCommitRequestSchema =
  connectedAddCommitRequestSchemaDefinition;
export type ConnectedAddCommitRequest = z.infer<typeof connectedAddCommitRequestSchema>;

const connectedInvoiceTargetSchemaDefinition = z.object({ stripeInvoiceId: z.string().min(1) });
export interface ConnectedInvoiceTargetSchema extends Named<
  typeof connectedInvoiceTargetSchemaDefinition
> {}
export const connectedInvoiceTargetSchema: ConnectedInvoiceTargetSchema =
  connectedInvoiceTargetSchemaDefinition;

const connectedBillingAccountViewSchemaDefinition = z.object({
  id: z.string(),
  organizationId: z.string(),
  stripeCustomerId: z.string(),
  termStartsAt: z.string(),
  termEndsAt: z.string(),
  commitUsdCents: z.number(),
  seatCurrency: currencySchema,
  seatRateCents: z.number(),
  seats: z.number(),
  bankTransferType: z.enum(["us_bank_transfer", "eu_bank_transfer"]).nullable(),
  bankTransferCountry: z.string().nullable(),
  billingEmail: z.string(),
  /** Whether a renewal's credit still waits on the old term's last usage invoice. */
  renewalPending: z.boolean(),
});
export interface ConnectedBillingAccountViewSchema extends Named<
  typeof connectedBillingAccountViewSchemaDefinition
> {}
export const connectedBillingAccountViewSchema: ConnectedBillingAccountViewSchema =
  connectedBillingAccountViewSchemaDefinition;
export type ConnectedBillingAccountView = z.infer<typeof connectedBillingAccountViewSchema>;

const connectedCreditGrantViewSchemaDefinition = z.object({
  stripeCreditGrantId: z.string(),
  amountUsdCents: z.number(),
  kind: z.enum(["commit", "added", "renewal"]),
  termEndsAt: z.string(),
  expiresAt: z.string(),
});
export interface ConnectedCreditGrantViewSchema extends Named<
  typeof connectedCreditGrantViewSchemaDefinition
> {}
export const connectedCreditGrantViewSchema: ConnectedCreditGrantViewSchema =
  connectedCreditGrantViewSchemaDefinition;
export type ConnectedCreditGrantView = z.infer<typeof connectedCreditGrantViewSchema>;

const connectedInvoiceViewSchemaDefinition = z.object({
  stripeInvoiceId: z.string(),
  kind: z.enum(["annual", "seat_change", "usage"]),
  currency: currencySchema,
  amountCents: z.number(),
  status: z.string(),
  paidOutOfBandAt: z.string().nullable(),
});
export interface ConnectedInvoiceViewSchema extends Named<
  typeof connectedInvoiceViewSchemaDefinition
> {}
export const connectedInvoiceViewSchema: ConnectedInvoiceViewSchema =
  connectedInvoiceViewSchemaDefinition;

const connectedSeatChangeViewSchemaDefinition = z.object({
  licenseId: z.string(),
  changedAt: z.string(),
  addedSeats: z.number(),
  amountCents: z.number(),
  /** Null until billing decided the change against a billing account. */
  currency: currencySchema.nullable(),
  /** `awaiting`: licensing recorded the change and billing has not decided it yet. */
  state: z.enum(["awaiting", "intent", "invoiced", "nothing_to_invoice", "not_onboarded"]),
  stripeInvoiceId: z.string().nullable(),
});
export interface ConnectedSeatChangeViewSchema extends Named<
  typeof connectedSeatChangeViewSchemaDefinition
> {}
export const connectedSeatChangeViewSchema: ConnectedSeatChangeViewSchema =
  connectedSeatChangeViewSchemaDefinition;

/** The contract budget as the customer's own calls see it. `spentUsdCents` is null when unread, never zero. */
const connectedSpendViewSchemaDefinition = z.object({
  spendAvailable: z.boolean(),
  limitUsdCents: z.number(),
  spentUsdCents: z.number().nullable(),
});
export interface ConnectedSpendViewSchema extends Named<
  typeof connectedSpendViewSchemaDefinition
> {}
export const connectedSpendViewSchema: ConnectedSpendViewSchema =
  connectedSpendViewSchemaDefinition;
export type ConnectedSpendView = z.infer<typeof connectedSpendViewSchema>;

const connectedBillingOverviewSchemaDefinition = z.object({
  account: connectedBillingAccountViewSchema.nullable(),
  grants: z.array(connectedCreditGrantViewSchema),
  invoices: z.array(connectedInvoiceViewSchema),
  spend: connectedSpendViewSchema,
  terms: z.object({
    commitUsdCents: z.number(),
    maximumUsdCents: z.number(),
    overageEnabled: z.boolean(),
  }),
  seats: z.object({
    licensed: z.number(),
    reported: z.number().nullable(),
    lastSyncAt: z.string().nullable(),
  }),
  seatChanges: z.array(connectedSeatChangeViewSchema),
});
export interface ConnectedBillingOverviewSchema extends Named<
  typeof connectedBillingOverviewSchemaDefinition
> {}
export const connectedBillingOverviewSchema: ConnectedBillingOverviewSchema =
  connectedBillingOverviewSchemaDefinition;
export type ConnectedBillingOverview = z.infer<typeof connectedBillingOverviewSchema>;

const connectedRenewalOutcomeSchemaDefinition = z.object({
  outcome: z.enum(["completed", "waiting", "none"]),
});
export interface ConnectedRenewalOutcomeSchema extends Named<
  typeof connectedRenewalOutcomeSchemaDefinition
> {}
export const connectedRenewalOutcomeSchema: ConnectedRenewalOutcomeSchema =
  connectedRenewalOutcomeSchemaDefinition;
