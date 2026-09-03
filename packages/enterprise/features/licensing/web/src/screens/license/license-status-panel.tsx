/**
 * The license card, over one read.
 *
 * Renamed from `LicenseStatus` on the way in: `LicenseStatus` is already the
 * CONTRACT's name for the payload this component renders, and a component and a
 * payload type sharing a name inside one package is a confusion the move can
 * settle for free.
 */

import { VStack } from "@chakra-ui/react";
import { useState } from "react";
import { licensingApi } from "../../behavior/licensing-api";
import { LicenseDetailsCard } from "../../components/license-details-card";
import { LicenseLoadError } from "../../components/license-load-error";
import { LicenseLoadingSkeleton } from "../../components/license-loading-skeleton";
import { OverSeatsCallout } from "../../components/over-seats-callout";
import { licenseMetersSeats, normalizeKeyForActivation } from "../../license-status";
import { LicenseGeneratorDrawer } from "./license-generator-drawer";
import { NoLicenseCard } from "./no-license-card";
import { useLicenseActions } from "./use-license-actions";

interface LicenseStatusPanelProps {
  organizationId: string;
  isGeneratorOpen: boolean;
  onGeneratorOpenChange: (open: boolean) => void;
}

export function LicenseStatusPanel({
  organizationId,
  isGeneratorOpen,
  onGeneratorOpenChange,
}: LicenseStatusPanelProps) {
  const [licenseKey, setLicenseKey] = useState("");

  const {
    data: status,
    isLoading,
    isError,
    refetch,
  } = licensingApi.license.getStatus.useQuery(
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
