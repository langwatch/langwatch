// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `connectedBilling.*` (ADR-156 section 7): gated like the
 * license registry, on the platform-operator grant checked by the application,
 * never an org-scoped RBAC permission, and refused with the shared not-found.
 */
import { defineTrpcFact, defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  BillingApi,
  connectedBillingTrpc,
  type BillingStaff,
} from "@langwatch/enterprise-billing-contract";
import {
  AdminSurfaceHiddenError,
  opsOperatorSchema,
  type OpsOperator,
} from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
export const operatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

const STAFF_LIST = {
  reason:
    "back-office surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design",
  allow: {
    organizationId:
      "names the customer organization being billed; the caller's reach is the platform-operator grant and is never derived from this id",
  },
} as const;

/**
 * The impersonator where there is one: debugging a customer stays operator work. An impersonator
 * with no id is nobody billing can ask, so the call is refused, never run as the customer.
 */
function getStaff(operator: OpsOperator | null): BillingStaff {
  if (!operator) throw new AdminSurfaceHiddenError();
  const { impersonator } = operator;
  if (!impersonator) return { id: operator.id, email: operator.email };
  if (!impersonator.id) throw new AdminSurfaceHiddenError();
  return { id: impersonator.id, email: impersonator.email };
}

export const connectedBillingTrpcTransport: TrpcRouterDeclaration<
  BillingApi,
  typeof connectedBillingTrpc
> = defineTrpcRouter(BillingApi, connectedBillingTrpc)
  .procedure("get")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.getConnectedBillingOverview(input, getStaff(operator)))

  .procedure("onboard")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.onboardConnectedCustomer(input, getStaff(operator)))

  .procedure("addCommit")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.addConnectedCommit(input, getStaff(operator)))

  .procedure("renew")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.renewConnectedTerm(input, getStaff(operator)))

  .procedure("completeRenewalIfDue")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(async ({ app, input }, operator) => ({
    outcome: await app.completeConnectedRenewalIfDue(input, getStaff(operator)),
  }))

  .procedure("markPaidOutOfBand")
  .withFacts(operatorFact)
  .noPermission({ reason: STAFF_LIST.reason })
  .handle(async ({ app, input }, operator) => {
    await app.markConnectedInvoicePaidOutOfBand(input, getStaff(operator));
    return { stripeInvoiceId: input.stripeInvoiceId };
  })
  .build();
