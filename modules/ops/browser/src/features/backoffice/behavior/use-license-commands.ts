import { api } from "../../../behavior/ops-api.ts";
import { useOpsToaster, useShowErrorToast } from "../../../behavior/ops-feedback.ts";

/** The license writes, each one invalidating the registry and reporting itself. */
export function useLicenseCommands() {
  const utils = api.useContext();
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();
  const after = (title: string) => ({
    onSuccess: async () => {
      await utils.licenseRegistry.invalidate();
      toaster.create({ title, type: "success", duration: 3000 });
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "The license was not changed" }),
  });
  return {
    revoke: api.licenseRegistry.revoke.useMutation(after("License revoked")),
    resetInstanceBinding: api.licenseRegistry.resetInstanceBinding.useMutation(
      after("Instance binding reset"),
    ),
    updateTerms: api.licenseRegistry.updateTerms.useMutation(after("Terms saved")),
    linkToOrganization: api.licenseRegistry.linkToOrganization.useMutation(after("License linked")),
    changeSeats: api.licenseRegistry.changeSeats.useMutation(),
    reissue: api.licenseRegistry.reissue.useMutation(),
    issue: api.licenseRegistry.issue.useMutation(),
    registerLegacy: api.licenseRegistry.registerLegacy.useMutation(),
  };
}
