import { api } from "../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../behavior/ops-feedback.ts";

/** The testing-license token writes, each one invalidating the list. */
export function useTestingLicenseTokenCommands() {
  const utils = api.useContext();
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();

  return {
    createServiceToken: api.licenseRegistry.createTestingLicenseServiceToken.useMutation({
      onSuccess: async () => {
        await utils.licenseRegistry.invalidate();
      },
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The token was not created" }),
    }),
    revoke: api.licenseRegistry.revokeTestingLicenseToken.useMutation({
      onSuccess: async () => {
        await utils.licenseRegistry.invalidate();
        toaster.create({ title: "Token revoked", type: "success", duration: 3000 });
      },
      onError: (error: unknown) =>
        showErrorToast({ error, fallbackTitle: "The token was not revoked" }),
    }),
  };
}
