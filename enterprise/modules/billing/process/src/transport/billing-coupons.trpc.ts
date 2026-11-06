// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of `billingCoupons.*`: behind the platform door, as connected billing is.
 * Non-staff are answered not-found, staff lacking ops:manage are refused a write by name.
 */
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import { BillingApi, billingCouponsTrpc } from "@langwatch/enterprise-billing-contract";

import { getStaff, operatorContext, STAFF } from "./connected-billing.trpc.ts";

export const billingCouponsTrpcTransport: TrpcRouterDeclaration<
  BillingApi,
  typeof billingCouponsTrpc
> = defineTrpcRouter(BillingApi, billingCouponsTrpc)
  .procedure("list")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app }, operator) => app.listCoupons(getStaff(operator)))

  .procedure("create")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.createCoupon(input, getStaff(operator)))

  .procedure("deactivateCode")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.deactivatePromotionCode(input, getStaff(operator)))
  .build();
