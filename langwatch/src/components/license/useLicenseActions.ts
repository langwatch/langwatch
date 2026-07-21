import { showErrorToast } from "~/features/errors";
import { api } from "~/utils/api";
import { toaster } from "../ui/toaster";
import { getUserFriendlyLicenseError } from "../../../ee/licensing/constants";

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
  const uploadMutation = api.license.upload.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License activated",
        description: "Your license has been successfully activated.",
        type: "success",
      });
      onUploadSuccess();
      window.location.reload();
    },
    onError: (error) => {
      // License validation rejects with a curated, actionable message that no
      // error code covers ("the key is invalid or has been tampered with").
      // Keep it when we recognise it; anything else goes through the registry
      // so an internal message never reaches the customer.
      const friendly = getUserFriendlyLicenseError(error.message);
      if (friendly !== error.message) {
        toaster.create({
          title: "Couldn't activate license",
          description: friendly,
          type: "error",
        });
        return;
      }
      showErrorToast({ error, fallbackTitle: "Couldn't activate license" });
    },
  });

  const removeMutation = api.license.remove.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License removed",
        description: "Your organization is now running without a license. Some features may be limited.",
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
