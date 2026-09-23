/**
 * The license card, over one read. Renamed from `LicenseStatus`, which is
 * already the CONTRACT's name for the payload this component renders —
 * sharing a name between component and payload type invited confusion.
 */

import { VStack } from "@chakra-ui/react";
import { useState } from "react";

import { licensingApi } from "../../behavior/licensing-api.ts";
import { licenseMetersSeats, normalizeKeyForActivation } from "../../model/license-status.ts";
import { LicenseDetailsCard } from "../../ui/elements/license-details-card.tsx";
import { LicenseLoadError } from "../../ui/elements/license-load-error.tsx";
import { LicenseLoadingSkeleton } from "../../ui/elements/license-loading-skeleton.tsx";
import { OverSeatsCallout } from "../../ui/elements/over-seats-callout.tsx";
import { NoLicenseCard } from "./no-license-card.tsx";
import { useLicenseActions } from "./use-license-actions.ts";

interface LicenseStatusPanelProps {
  organizationId: string;
}

export function LicenseStatusPanel({ organizationId }: LicenseStatusPanelProps) {
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

  const [activationCode, setActivationCode] = useState("");
  const { upload, activate, remove, refresh, isUploading, isRemoving, isRefreshing } =
    useLicenseActions({
      organizationId,
      onUploadSuccess: () => {
        setLicenseKey("");
        setActivationCode("");
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
          activationCode={activationCode}
          onActivationCodeChange={setActivationCode}
          onCodeActivate={() => activate(activationCode.trim())}
          isActivating={isUploading}
        />
      </VStack>
    );
  }

  return (
    <VStack align="start" gap={0} width="full">
      {licenseMetersSeats(status) && (
        <OverSeatsCallout currentMembers={status.currentMembers} maxMembers={status.maxMembers} />
      )}
      <LicenseDetailsCard
        status={status}
        onRemove={remove}
        isRemoving={isRemoving}
        onRefresh={refresh}
        isRefreshing={isRefreshing}
      />
    </VStack>
  );
}
