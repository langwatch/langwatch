import { VStack } from "@chakra-ui/react";
import { useState } from "react";
import { api } from "~/utils/api";
import { LicenseDetailsCard } from "./license/LicenseDetailsCard";
import { LicenseGeneratorDrawer } from "./license/LicenseGeneratorDrawer";
import { LicenseLoadError } from "./license/LicenseLoadError";
import { LicenseLoadingSkeleton } from "./license/LicenseLoadingSkeleton";
import {
  licenseMetersSeats,
  normalizeKeyForActivation,
} from "./license/licenseStatusUtils";
import { NoLicenseCard } from "./license/NoLicenseCard";
import { OverSeatsCallout } from "./license/OverSeatsCallout";
import { useLicenseActions } from "./license/useLicenseActions";

interface LicenseStatusProps {
  organizationId: string;
  isGeneratorOpen: boolean;
  onGeneratorOpenChange: (open: boolean) => void;
}

export function LicenseStatus({
  organizationId,
  isGeneratorOpen,
  onGeneratorOpenChange,
}: LicenseStatusProps) {
  const [licenseKey, setLicenseKey] = useState("");

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = api.license.getStatus.useQuery(
    { organizationId },
    {
      enabled: !!organizationId,
      refetchOnWindowFocus: false,
      staleTime: 30_000, // Consider fresh for 30 seconds
    },
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

  const handleFileActivate = (fileContent: string) => {
    const normalizedKey = normalizeKeyForActivation(fileContent);
    if (normalizedKey) {
      upload(normalizedKey);
    }
  };

  if (isLoading) {
    return <LicenseLoadingSkeleton />;
  }

  if (isError) {
    return <LicenseLoadError onRetry={() => void refetch()} />;
  }

  if (!status?.hasLicense) {
    return (
      <VStack align="start" gap={0} width="full">
        <NoLicenseCard
          licenseKey={licenseKey}
          onLicenseKeyChange={setLicenseKey}
          onActivate={handleActivate}
          onFileActivate={handleFileActivate}
          isActivating={isUploading}
        />
        <LicenseGeneratorDrawer
          open={isGeneratorOpen}
          onClose={() => onGeneratorOpenChange(false)}
          organizationId={organizationId}
        />
      </VStack>
    );
  }

  return (
    <VStack align="start" gap={0} width="full">
      {licenseMetersSeats(status) && (
        <OverSeatsCallout
          currentMembers={status.currentMembers}
          maxMembers={status.maxMembers}
        />
      )}
      <LicenseDetailsCard status={status} onRemove={remove} isRemoving={isRemoving} />
      <LicenseGeneratorDrawer
        open={isGeneratorOpen}
        onClose={() => onGeneratorOpenChange(false)}
        organizationId={organizationId}
      />
    </VStack>
  );
}
