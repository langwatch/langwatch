// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/** A connected customer's billing facts, keyed by organization; connect moves the budget (C3a). */
export const CONNECTED_BILLING_AGGREGATE_TYPE = "connected_billing" as const;
export const CONNECTED_BILLING_EVENT_VERSION = "2026-10-09" as const;
export const CONNECTED_CUSTOMER_ONBOARDED_EVENT_TYPE =
  "lw.billing.connected_customer_onboarded" as const;
export const CONNECTED_TERM_RENEWED_EVENT_TYPE = "lw.billing.connected_term_renewed" as const;

/** An operator's step on one connected customer; the fact names who took it and when. */
const connectedBillingFactDataSchema = z.object({
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  operatorId: z.string().min(1),
});

/** A connected customer was onboarded, or its onboarding completed; connect syncs the budget. */
export const connectedCustomerOnboardedEventDataSchema = connectedBillingFactDataSchema;
export type ConnectedCustomerOnboardedEventData = z.infer<
  typeof connectedCustomerOnboardedEventDataSchema
>;

/** A connected customer renewed for a new term; connect starts a new window, then syncs. */
export const connectedTermRenewedEventDataSchema = connectedBillingFactDataSchema;
export type ConnectedTermRenewedEventData = z.infer<typeof connectedTermRenewedEventDataSchema>;
