import { api } from "~/utils/api";

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
    onSuccess: onUploadSuccess,
  });

  const removeMutation = api.license.remove.useMutation({
    onSuccess: onRemoveSuccess,
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
    uploadError: uploadMutation.error,
    removeError: removeMutation.error,
    isUploadSuccess: uploadMutation.isSuccess,
    isRemoveSuccess: removeMutation.isSuccess,
    resetUpload: uploadMutation.reset,
    resetRemove: removeMutation.reset,
  };
}
