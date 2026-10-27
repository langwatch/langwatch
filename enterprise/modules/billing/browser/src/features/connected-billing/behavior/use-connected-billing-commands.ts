// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";

import { connectedBillingApi } from "./connected-billing-api.ts";

/** The connected billing writes, each one refreshing the panel and reporting itself. */
export function useConnectedBillingCommands() {
  const utils = connectedBillingApi.useUtils();
  const after = (title: string) => ({
    onSuccess: async () => {
      await utils.connectedBilling.invalidate();
      toaster.create({ title, type: "success", duration: 3000 });
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Billing was not changed" }),
  });
  return {
    onboard: connectedBillingApi.connectedBilling.onboard.useMutation(after("Customer onboarded")),
    addCommit: connectedBillingApi.connectedBilling.addCommit.useMutation(after("Commit added")),
    renew: connectedBillingApi.connectedBilling.renew.useMutation(after("Contract renewed")),
    markPaidOutOfBand: connectedBillingApi.connectedBilling.markPaidOutOfBand.useMutation(
      after("Invoice marked paid"),
    ),
  };
}
