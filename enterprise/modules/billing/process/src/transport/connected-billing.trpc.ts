// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `connectedBilling.*` (ADR-156 section 7): gated like the
 * license registry, on the ADMIN_EMAILS staff list checked by the application,
 * never an RBAC permission, and refused with the shared not-found.
 */
import { defineTrpcFact, defineTrpcRouter } from "@langwatch/api/trpc";
import {
  BillingApi,
  connectedBillingTrpc,
  type BillingStaff,
} from "@langwatch/enterprise-billing-contract";
import { opsOperatorSchema, type OpsOperator } from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
const operatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

const STAFF_LIST = {
  reason:
    "back-office surface gated on the ADMIN_EMAILS staff list, not on an RBAC permission; cross-tenant by design",
  allow: {
    organizationId:
      "names the customer organization being billed; the caller's reach is the ADMIN_EMAILS staff list and is never derived from this id",
  },
} as const;

/** The impersonator where there is one: debugging a customer stays operator work. */
function staffOf(operator: OpsOperator): BillingStaff {
  const impersonator = operator.impersonator;
  return impersonator
    ? { id: impersonator.id ?? operator.id, email: impersonator.email }
    : { id: operator.id, email: operator.email };
}

export const connectedBillingTrpcTransport = defineTrpcRouter(BillingApi, connectedBillingTrpc)
  .procedure("get")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) =>
    app.getConnectedBillingOverview(input, operator && staffOf(operator)),
  )

  .procedure("onboard")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) =>
    app.onboardConnectedCustomer(input, operator && staffOf(operator)),
  )

  .procedure("addCommit")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) =>
    app.addConnectedCommit(input, operator && staffOf(operator)),
  )

  .procedure("renew")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) =>
    app.renewConnectedTerm(input, operator && staffOf(operator)),
  )

  .procedure("completeRenewalIfDue")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(async ({ app, input }, operator) => ({
    outcome: await app.completeConnectedRenewalIfDue(input, operator && staffOf(operator)),
  }))

  .procedure("markPaidOutOfBand")
  .withFacts(operatorFact)
  .noPermission({ reason: STAFF_LIST.reason })
  .handle(async ({ app, input }, operator) => {
    await app.markConnectedInvoicePaidOutOfBand(input, operator && staffOf(operator));
    return { stripeInvoiceId: input.stripeInvoiceId };
  })
  .build();
