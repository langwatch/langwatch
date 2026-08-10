import { showErrorToast } from "~/features/errors";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";

interface UseLicenseActionsOptions {
  organizationId: string;
  onUploadSuccess: () => void;
  onRemoveSuccess: () => void;
}

export function useLicenseActions({
  organizationId,
  onUploadSuccess,
  onRemoveSuccess,
}: UseLicenseActionsOptions) {
  const publicEnv = usePublicEnv();
  // The SSO license gate is decided once per process (ADR-027), so a license
  // activated on a running self-hosted server only enables SSO after a restart.
  // Only a confirmed `true` means Cloud: while the environment is still
  // resolving, showing the restart line is the harmless reading, and omitting
  // it on a self-hosted deployment is not.
  const isSaas = publicEnv.data?.IS_SAAS === true;

  // Activating or removing a license moves the active plan, which half the app
  // reads: navigation, feature gates, limit copy. Invalidating every query is
  // the blunt instrument that catches all of them, and it is what replaced a
  // `window.location.reload()` here. The reload refreshed the same state, and
  // destroyed the toast on its way: the restart instruction below is the one
  // thing an operator has to read, and it was being torn off the screen
  // milliseconds after it appeared.
  const trpc = api.useUtils();
  const refreshPlanDerivedState = () => {
    void trpc.invalidate();
  };

  const uploadMutation = api.license.upload.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License activated",
        description: isSaas
          ? "Your license has been successfully activated."
          : "Your license has been successfully activated. If your deployment uses SSO, restart the server to enable it.",
        type: "success",
      });
      onUploadSuccess();
      refreshPlanDerivedState();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't activate license" }),
  });

  const removeMutation = api.license.remove.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License removed",
        description:
          "Your organization is now running without a license. Some features may be limited.",
        type: "info",
      });
      onRemoveSuccess();
      refreshPlanDerivedState();
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't remove license" }),
  });

  const upload = (licenseKey: string) => {
    uploadMutation.mutate({ organizationId, licenseKey });
  };

  const remove = () => {
    removeMutation.mutate({ organizationId });
  };

  return {
    upload,
    remove,
    isUploading: uploadMutation.isPending,
    isRemoving: removeMutation.isPending,
  };
}
