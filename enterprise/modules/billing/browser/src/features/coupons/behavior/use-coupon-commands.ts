// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";

import { billingCouponsApi } from "./billing-coupons-api.ts";

/**
 * The coupon writes, each refreshing the list. Create reports its own failure in the drawer,
 * on the fields the server named; deactivate reports through a toast.
 */
export function useCouponCommands() {
  const utils = billingCouponsApi.useUtils();
  const refresh = () => utils.billingCoupons.invalidate();
  return {
    create: billingCouponsApi.billingCoupons.create.useMutation({
      onSuccess: async (coupon) => {
        await refresh();
        const code = coupon.codes[0]?.code;
        toaster.create({
          title: code ? `Coupon ${code} created` : "Coupon created",
          type: "success",
          duration: 3000,
        });
      },
    }),
    deactivateCode: billingCouponsApi.billingCoupons.deactivateCode.useMutation({
      onSuccess: async () => {
        await refresh();
        toaster.create({ title: "Code deactivated", type: "success", duration: 3000 });
      },
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The code was not deactivated" }),
    }),
  };
}
