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
  const isSelfHosted = publicEnv.data?.IS_SAAS === false;

  const uploadMutation = api.license.upload.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License activated",
        description: isSelfHosted
          ? "Your license has been successfully activated. If your deployment uses SSO, restart the server to enable it."
          : "Your license has been successfully activated.",
        type: "success",
      });
      onUploadSuccess();
      window.location.reload();
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
      window.location.reload();
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
    isUploading: uploadMutation.isLoading,
    isRemoving: removeMutation.isLoading,
  };
}
