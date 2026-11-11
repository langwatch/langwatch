// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
import type { billingCouponsTrpc } from "@langwatch/enterprise-billing-contract";

/** `billingCoupons.*`, derived from the contract's declarations. */
export const billingCouponsApi = createModuleApi<ContractApiMap<typeof billingCouponsTrpc>>();
