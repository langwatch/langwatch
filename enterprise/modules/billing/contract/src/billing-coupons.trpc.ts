// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `billingCoupons.*`: the Cloud admin console's Stripe coupons and promotion codes,
 * gated on the platform-operator grant and answered 404 to anybody else.
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  couponListSchema,
  couponViewSchema,
  createCouponRequestSchema,
  promotionCodeTargetSchema,
} from "./billing-coupons.schemas.ts";

export const billingCouponsTrpc = defineTrpcContract("billingCoupons")
  .query("list")
  .withInput(z.object({}))
  .withOutput(couponListSchema)

  .mutation("create")
  .withInput(createCouponRequestSchema)
  .withOutput(couponViewSchema)

  .mutation("deactivateCode")
  .withInput(promotionCodeTargetSchema)
  .withOutput(promotionCodeTargetSchema)
  .build();
