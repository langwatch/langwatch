import { useEffect, useState } from "react";
import { api } from "~/utils/api";
import { LicenseDetailsCard } from "./license/LicenseDetailsCard";
import { LicenseLoadingSkeleton } from "./license/LicenseLoadingSkeleton";
import { NoLicenseCard } from "./license/NoLicenseCard";
import { useLicenseActions } from "./license/useLicenseActions";
import { normalizeKeyForActivation } from "./license/useLicenseStatus";
import { toaster } from "./ui/toaster";

interface LicenseStatusProps {
  organizationId: string;
}

export function LicenseStatus({ organizationId }: LicenseStatusProps) {
  const [licenseKey, setLicenseKey] = useState("");

  const {
    data: status,
    isLoading,
    refetch,
  } = api.license.getStatus.useQuery(
    { organizationId },
    { enabled: !!organizationId }
  );

  const {
    upload,
    remove,
    isUploading,
    isRemoving,
    uploadError,
    removeError,
    isUploadSuccess,
    isRemoveSuccess,
    resetUpload,
    resetRemove,
  } = useLicenseActions({
    organizationId,
    onUploadSuccess: () => {
      setLicenseKey("");
      void refetch();
    },
    onRemoveSuccess: () => {
      void refetch();
    },
  });

  useEffect(() => {
    if (isUploadSuccess) {
      toaster.create({
        title: "License activated",
        description: "Your license has been successfully activated.",
        type: "success",
      });
      resetUpload();
    }
  }, [isUploadSuccess, resetUpload]);

  useEffect(() => {
    if (uploadError) {
      toaster.create({
        title: "Failed to activate license",
        description: uploadError.message,
        type: "error",
      });
      resetUpload();
    }
  }, [uploadError, resetUpload]);

  useEffect(() => {
    if (isRemoveSuccess) {
      toaster.create({
        title: "License removed",
        description: "Your organization is now running in unlimited mode.",
        type: "info",
      });
      resetRemove();
    }
  }, [isRemoveSuccess, resetRemove]);

  useEffect(() => {
    if (removeError) {
      toaster.create({
        title: "Failed to remove license",
        description: removeError.message,
        type: "error",
      });
      resetRemove();
    }
  }, [removeError, resetRemove]);

  const handleActivate = () => {
    const normalizedKey = normalizeKeyForActivation(licenseKey);
    if (normalizedKey) {
      upload(normalizedKey);
    }
  };

  if (isLoading) {
    return <LicenseLoadingSkeleton />;
  }

  if (!status?.hasLicense) {
    return (
      <NoLicenseCard
        licenseKey={licenseKey}
        onLicenseKeyChange={setLicenseKey}
        onActivate={handleActivate}
        isActivating={isUploading}
      />
    );
  }

  return (
    <LicenseDetailsCard
      status={status}
      onRemove={remove}
      isRemoving={isRemoving}
    />
  );
}
