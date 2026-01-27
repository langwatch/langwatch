import { useState } from "react";
import { VStack } from "@chakra-ui/react";
import { api } from "~/utils/api";
import { LicenseDetailsCard } from "./license/LicenseDetailsCard";
import { LicenseGeneratorDrawer } from "./license/LicenseGeneratorDrawer";
import { LicenseLoadingSkeleton } from "./license/LicenseLoadingSkeleton";
import { NoLicenseCard } from "./license/NoLicenseCard";
import { useLicenseActions } from "./license/useLicenseActions";
import { normalizeKeyForActivation } from "./license/licenseStatusUtils";

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
      <LicenseDetailsCard
        status={status}
        onRemove={remove}
        isRemoving={isRemoving}
      />
      <LicenseGeneratorDrawer
        open={isGeneratorOpen}
        onClose={() => onGeneratorOpenChange(false)}
        organizationId={organizationId}
      />
    </VStack>
  );
}
