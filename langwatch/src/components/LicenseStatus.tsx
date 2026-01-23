import { useState } from "react";
import { api } from "~/utils/api";
import { LicenseDetailsCard } from "./license/LicenseDetailsCard";
import { LicenseLoadingSkeleton } from "./license/LicenseLoadingSkeleton";
import { NoLicenseCard } from "./license/NoLicenseCard";
import { useLicenseActions } from "./license/useLicenseActions";
import { normalizeKeyForActivation } from "./license/useLicenseStatus";

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

  const { upload, remove, isUploading, isRemoving } = useLicenseActions({
    organizationId,
    onUploadSuccess: () => {
      setLicenseKey("");
      void refetch();
    },
    onRemoveSuccess: () => {
      void refetch();
    },
  });

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
