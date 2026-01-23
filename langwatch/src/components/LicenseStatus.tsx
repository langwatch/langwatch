import { useEffect, useState } from "react";
import { api } from "~/utils/api";
import { LicenseDetailsCard } from "./license/LicenseDetailsCard";
import { LicenseLoadingSkeleton } from "./license/LicenseLoadingSkeleton";
import { NoLicenseCard } from "./license/NoLicenseCard";
import { useLicenseActions } from "./license/useLicenseActions";
import { normalizeKeyForActivation } from "./license/licenseStatusUtils";
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
    uploadSuccess,
    uploadError,
    removeSuccess,
    removeError,
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
    if (uploadSuccess) {
      toaster.create({
        title: "License activated",
        description: "Your license has been successfully activated.",
        type: "success",
      });
    }
  }, [uploadSuccess]);

  useEffect(() => {
    if (uploadError) {
      toaster.create({
        title: "Failed to activate license",
        description: uploadError.message,
        type: "error",
      });
    }
  }, [uploadError]);

  useEffect(() => {
    if (removeSuccess) {
      toaster.create({
        title: "License removed",
        description: "Your organization is now running in unlimited mode.",
        type: "info",
      });
    }
  }, [removeSuccess]);

  useEffect(() => {
    if (removeError) {
      toaster.create({
        title: "Failed to remove license",
        description: removeError.message,
        type: "error",
      });
    }
  }, [removeError]);

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
