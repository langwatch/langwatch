/**
 * The license card, over one read. Renamed from `LicenseStatus`, which is
 * already the CONTRACT's name for the payload this component renders —
 * sharing a name between component and payload type invited confusion.
 */

import { VStack } from "@langwatch/design-system/primitives";
import { detectLicenseInputForm } from "@langwatch/enterprise-licensing-contract";
import { useState } from "react";

import { licensingApi } from "../../behavior/licensing-api.ts";
import { licenseMetersSeats } from "../../model/license-status.ts";
import { LicenseDetailsCard } from "../../ui/elements/license-details-card.tsx";
import { LicenseLoadError } from "../../ui/elements/license-load-error.tsx";
import { LicenseLoadingSkeleton } from "../../ui/elements/license-loading-skeleton.tsx";
import { OverSeatsCallout } from "../../ui/elements/over-seats-callout.tsx";
import { NoLicenseCard } from "./no-license-card.tsx";
import { useLicenseActions } from "./use-license-actions.ts";

/** A signed license key is a base64 blob of a few hundred characters. */
const MIN_LICENSE_KEY_LENGTH = 64;

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

  // Every field accepts both forms, the same as LANGWATCH_LICENSE_KEY: the
  // value's shape decides whether it is redeemed as a code or stored as a key.
  const submitLicense = (text: string) => {
    const input = detectLicenseInputForm(text);
    if (input.form === "activation_code") activate(input.code);
    else if (input.form === "license_key") upload(input.licenseKey);
  };

  // A short value that is not a code is a mistyped code, not a license key:
  // redeeming it gets the "malformed code" answer, not a license format error.
  const handleCodeActivate = () => {
    const typed = activationCode.trim();
    if (
      detectLicenseInputForm(typed).form === "license_key" &&
      typed.length < MIN_LICENSE_KEY_LENGTH
    ) {
      activate(typed);
      return;
    }
    submitLicense(activationCode);
  };

  if (isLoading) {
    return <LicenseLoadingSkeleton />;
  }

  if (isError) {
    return <LicenseLoadError onRetry={() => void refetch()} />;
  }

  if (!status?.hasLicense) {
    return (
      <VStack align="start" gap={6} width="full">
        <NoLicenseCard
          licenseKey={licenseKey}
          onLicenseKeyChange={setLicenseKey}
          onActivate={() => submitLicense(licenseKey)}
          onFileActivate={submitLicense}
          activationCode={activationCode}
          onActivationCodeChange={setActivationCode}
          onCodeActivate={handleCodeActivate}
          isActivating={isUploading}
        />
      </VStack>
    );
  }

  return (
    <VStack align="start" gap={6} width="full">
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
