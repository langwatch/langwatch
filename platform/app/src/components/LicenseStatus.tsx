import { VStack } from "@chakra-ui/react";
import { LicenseDetailsCard } from "./license/LicenseDetailsCard";
import { LicenseLoadError } from "./license/LicenseLoadError";
import { LicenseLoadingSkeleton } from "./license/LicenseLoadingSkeleton";
import { licenseMetersSeats } from "./license/licenseStatusUtils";
import { NoLicenseCard } from "./license/NoLicenseCard";
import { OverSeatsCallout } from "./license/OverSeatsCallout";
import { useLicenseScreen } from "./license/useLicenseScreen";

interface LicenseStatusProps {
  organizationId: string;
}

export function LicenseStatus({ organizationId }: LicenseStatusProps) {
  const screen = useLicenseScreen(organizationId);
  const { status } = screen;

  if (screen.isLoading) {
    return <LicenseLoadingSkeleton />;
  }

  if (screen.isError) {
    return <LicenseLoadError onRetry={screen.retry} />;
  }

  if (!status?.hasLicense) {
    return (
      <VStack align="start" gap={0} width="full">
        <NoLicenseCard
          licenseKey={screen.licenseKey}
          onLicenseKeyChange={screen.setLicenseKey}
          onActivate={screen.activateKey}
          onFileActivate={screen.activateFile}
          activationCode={screen.activationCode}
          onActivationCodeChange={screen.setActivationCode}
          onCodeActivate={screen.activateCode}
          isActivating={screen.isUploading}
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
      <LicenseDetailsCard
        status={status}
        onRemove={screen.remove}
        isRemoving={screen.isRemoving}
        onRefresh={screen.refresh}
        isRefreshing={screen.isRefreshing}
      />
    </VStack>
  );
}
