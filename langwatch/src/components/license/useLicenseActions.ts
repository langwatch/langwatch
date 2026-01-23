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
  const uploadMutation = api.license.upload.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License activated",
        description: "Your license has been successfully activated.",
        type: "success",
      });
      onUploadSuccess();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to activate license",
        description: error.message,
        type: "error",
      });
    },
  });

  const removeMutation = api.license.remove.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License removed",
        description: "Your organization is now running in unlimited mode.",
        type: "info",
      });
      onRemoveSuccess();
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
