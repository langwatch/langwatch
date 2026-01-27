import { useEffect, useState } from "react";
import { Box, Collapsible, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api } from "~/utils/api";
import { LicenseDetailsCard } from "./license/LicenseDetailsCard";
import { LicenseGeneratorForm } from "./license/LicenseGeneratorForm";
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
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);

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
        description: "Your organization is now running without a license. Some features may be limited.",
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

  const licenseGeneratorSection = (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      padding={4}
      width="full"
      maxWidth="600px"
      marginTop={4}
    >
      <Collapsible.Root
        open={isGeneratorOpen}
        onOpenChange={(details) => setIsGeneratorOpen(details.open)}
      >
        <Collapsible.Trigger asChild>
          <Box as="button" width="full" cursor="pointer">
            <HStack width="full">
              <Text fontSize="sm" fontWeight="medium">
                Generate License
              </Text>
              <Spacer />
              {isGeneratorOpen ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
            </HStack>
          </Box>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box paddingTop={4}>
            <LicenseGeneratorForm organizationId={organizationId} />
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );

  if (!status?.hasLicense) {
    return (
      <VStack align="start" gap={0}>
        <NoLicenseCard
          licenseKey={licenseKey}
          onLicenseKeyChange={setLicenseKey}
          onActivate={handleActivate}
          isActivating={isUploading}
        />
        {licenseGeneratorSection}
      </VStack>
    );
  }

  return (
    <VStack align="start" gap={0}>
      <LicenseDetailsCard
        status={status}
        onRemove={remove}
        isRemoving={isRemoving}
      />
      {licenseGeneratorSection}
    </VStack>
  );
}
