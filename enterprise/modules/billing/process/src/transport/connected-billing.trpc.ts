// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `connectedBilling.*` (ADR-156 section 7): behind the platform door (Q42/Q44).
 * Non-staff are answered not-found, staff lacking ops:manage are refused a write by name.
 */
import {
  defineMiddlewareContext,
  defineTrpcRouter,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
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
export const operatorContext = defineMiddlewareContext("opsOperator", opsOperatorSchema.nullable());

/** Staff hold ops:view at the platform; anyone else is answered not-found. */
const STAFF = { at: "platform", hiddenWithout: "ops:view" } as const;

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
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app, input }, operator) => app.getConnectedBillingOverview(input, getStaff(operator)))

  .procedure("onboard")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.onboardConnectedCustomer(input, getStaff(operator)))

  .procedure("addCommit")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.addConnectedCommit(input, getStaff(operator)))

  .procedure("renew")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.renewConnectedTerm(input, getStaff(operator)))

  .procedure("completeRenewalIfDue")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(async ({ app, input }, operator) => ({
    outcome: await app.completeConnectedRenewalIfDue(input, getStaff(operator)),
  }))

  .procedure("markPaidOutOfBand")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(async ({ app, input }, operator) => {
    await app.markConnectedInvoicePaidOutOfBand(input, getStaff(operator));
    return { stripeInvoiceId: input.stripeInvoiceId };
  })
  .build();
