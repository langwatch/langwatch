// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Invoice billing for a connected customer as the backoffice reads and writes
 * it (ADR-156 section 7). Instants travel as ISO strings: tRPC carries no transformer.
 */

import { z } from "zod";

const currencySchema = z.enum(["USD", "EUR"]);
const isoInstantSchema = z.iso.datetime({ offset: true });

/** The customer organization being billed; never the caller's own reach. */
export const connectedCustomerInputSchema = z.object({ organizationId: z.string().min(1) });

const contractTermsInput = {
  termStartsAt: isoInstantSchema,
  termEndsAt: isoInstantSchema,
  seats: z.number().int().positive(),
  seatRateCents: z.number().int().min(0),
  seatCurrency: currencySchema,
  commitUsdCents: z.number().int().min(0),
};

export const connectedOnboardRequestSchema = z.object({
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
export type ConnectedOnboardRequest = z.infer<typeof connectedOnboardRequestSchema>;

export const connectedRenewRequestSchema = z.object({
  ...connectedCustomerInputSchema.shape,
  ...contractTermsInput,
});
export type ConnectedRenewRequest = z.infer<typeof connectedRenewRequestSchema>;

export const connectedAddCommitRequestSchema = z.object({
  ...connectedCustomerInputSchema.shape,
  amountUsdCents: z.number().int().positive(),
});
export type ConnectedAddCommitRequest = z.infer<typeof connectedAddCommitRequestSchema>;

export const connectedInvoiceTargetSchema = z.object({ stripeInvoiceId: z.string().min(1) });

export const connectedBillingAccountViewSchema = z.object({
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
export type ConnectedBillingAccountView = z.infer<typeof connectedBillingAccountViewSchema>;

export const connectedCreditGrantViewSchema = z.object({
  stripeCreditGrantId: z.string(),
  amountUsdCents: z.number(),
  kind: z.enum(["commit", "added", "renewal"]),
  termEndsAt: z.string(),
  expiresAt: z.string(),
});
export type ConnectedCreditGrantView = z.infer<typeof connectedCreditGrantViewSchema>;

export const connectedInvoiceViewSchema = z.object({
  stripeInvoiceId: z.string(),
  kind: z.enum(["annual", "seat_change", "usage"]),
  currency: currencySchema,
  amountCents: z.number(),
  status: z.string(),
  paidOutOfBandAt: z.string().nullable(),
});

export const connectedSeatChangeViewSchema = z.object({
  licenseId: z.string(),
  changedAt: z.string(),
  addedSeats: z.number(),
  amountCents: z.number(),
  currency: currencySchema,
  state: z.enum(["intent", "invoiced", "nothing_to_invoice"]),
  stripeInvoiceId: z.string().nullable(),
});

/** The contract budget as the customer's own calls see it. `spentUsdCents` is null when unread, never zero. */
export const connectedSpendViewSchema = z.object({
  spendAvailable: z.boolean(),
  limitUsdCents: z.number(),
  spentUsdCents: z.number().nullable(),
});
export type ConnectedSpendView = z.infer<typeof connectedSpendViewSchema>;

export const connectedBillingOverviewSchema = z.object({
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
export type ConnectedBillingOverview = z.infer<typeof connectedBillingOverviewSchema>;

export const connectedRenewalOutcomeSchema = z.object({
  outcome: z.enum(["completed", "waiting", "none"]),
});
