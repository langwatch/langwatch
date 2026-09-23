// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `connectedBilling.*`: the backoffice's invoice billing for a connected
 * customer, gated on the operator staff list and answered 404 to anybody else.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  connectedAddCommitRequestSchema,
  connectedBillingAccountViewSchema,
  connectedBillingOverviewSchema,
  connectedCreditGrantViewSchema,
  connectedCustomerInputSchema,
  connectedInvoiceTargetSchema,
  connectedOnboardRequestSchema,
  connectedRenewalOutcomeSchema,
  connectedRenewRequestSchema,
} from "./connected-billing.schemas.ts";

export const connectedBillingTrpc = defineTrpcContract("connectedBilling")
  .query("get")
  .withInput(connectedCustomerInputSchema)
  .withOutput(connectedBillingOverviewSchema)

  .mutation("onboard")
  .withInput(connectedOnboardRequestSchema)
  .withOutput(connectedBillingAccountViewSchema)

  .mutation("addCommit")
  .withInput(connectedAddCommitRequestSchema)
  .withOutput(connectedCreditGrantViewSchema)

  .mutation("renew")
  .withInput(connectedRenewRequestSchema)
  .withOutput(connectedBillingAccountViewSchema)

  .mutation("completeRenewalIfDue")
  .withInput(connectedCustomerInputSchema)
  .withOutput(connectedRenewalOutcomeSchema)

  .mutation("markPaidOutOfBand")
  .withInput(connectedInvoiceTargetSchema)
  .withOutput(connectedInvoiceTargetSchema)
  .build();
