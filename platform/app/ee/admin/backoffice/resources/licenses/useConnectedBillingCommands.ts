import { toaster } from "~/components/ui/toaster";
import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";

/** The connected billing writes, each one refreshing the panel and reporting itself. */
export function useConnectedBillingCommands() {
  const utils = api.useContext();
  const after = (title: string) => ({
    onSuccess: async () => {
      await utils.connectedBilling.invalidate();
      toaster.create({ title, type: "success", duration: 3000 });
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "Billing was not changed" }),
  });
  return {
    onboard: api.connectedBilling.onboard.useMutation(
      after("Customer onboarded"),
    ),
    addCommit: api.connectedBilling.addCommit.useMutation(
      after("Commit added"),
    ),
    renew: api.connectedBilling.renew.useMutation(after("Contract renewed")),
    markPaidOutOfBand: api.connectedBilling.markPaidOutOfBand.useMutation(
      after("Invoice marked paid"),
    ),
  };
}
