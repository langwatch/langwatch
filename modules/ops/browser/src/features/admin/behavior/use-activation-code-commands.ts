import { api } from "../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../behavior/ops-feedback.ts";

/** The activation-code writes, each one invalidating the list. */
export function useActivationCodeCommands() {
  const utils = api.useContext();
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();

  return {
    issue: api.licenseRegistry.issueActivationCode.useMutation({
      onSuccess: async () => {
        await utils.licenseRegistry.invalidate();
      },
    }),
    revoke: api.licenseRegistry.revokeActivationCode.useMutation({
      onSuccess: async () => {
        await utils.licenseRegistry.invalidate();
        toaster.create({ title: "Activation code revoked", type: "success", duration: 3000 });
      },
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The activation code was not revoked" }),
    }),
  };
}
