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
      toaster.create({
        title: "Failed to activate license",
        description: getUserFriendlyLicenseError(error.message),
        type: "error",
      });
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
    onError: (error) => {
      toaster.create({
        title: "Failed to remove license",
        description: error.message,
        type: "error",
      });
    },
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
