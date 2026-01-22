import {
  Badge,
  Box,
  Button,
  HStack,
  Skeleton,
  SkeletonText,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { api } from "~/utils/api";
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

  const uploadMutation = api.license.upload.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License activated",
        description: "Your license has been successfully activated.",
        type: "success",
      });
      setLicenseKey("");
      void refetch();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to activate license",
        description: error.message,
        type: "error",
      });
    },
  });

  const removeMutation = api.license.remove.useMutation({
    onSuccess: () => {
      toaster.create({
        title: "License removed",
        description: "Your organization is now running in unlimited mode.",
        type: "info",
      });
      void refetch();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to remove license",
        description: error.message,
        type: "error",
      });
    },
  });

  const handleActivate = () => {
    if (!licenseKey.trim()) return;
    uploadMutation.mutate({
      organizationId,
      licenseKey: licenseKey.trim(),
    });
  };

  const handleRemove = () => {
    removeMutation.mutate({ organizationId });
  };

  if (isLoading) {
    return (
      <Box
        borderWidth="1px"
        borderRadius="lg"
        padding={6}
        width="full"
        maxWidth="600px"
      >
        <VStack align="start" gap={4}>
          <Skeleton height="24px" width="150px" />
          <SkeletonText noOfLines={3} gap={2} width="full" />
        </VStack>
      </Box>
    );
  }

  if (!status?.hasLicense) {
    return (
      <Box
        borderWidth="1px"
        borderRadius="lg"
        padding={6}
        width="full"
        maxWidth="600px"
      >
        <VStack align="start" gap={4}>
          <VStack align="start" gap={1}>
            <Text fontWeight="semibold" fontSize="lg">
              No license installed
            </Text>
            <Text color="gray.500" fontSize="sm">
              Running in unlimited mode. All features are available without
              restrictions.
            </Text>
          </VStack>

          <VStack align="start" gap={2} width="full">
            <Text fontSize="sm" fontWeight="medium">
              Activate a license:
            </Text>
            <Textarea
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              placeholder="Paste your license key here..."
              size="sm"
              rows={4}
              fontFamily="mono"
              fontSize="xs"
            />
            <Button
              colorScheme="blue"
              size="sm"
              onClick={handleActivate}
              loading={uploadMutation.isLoading}
              disabled={!licenseKey.trim() || uploadMutation.isLoading}
            >
              Activate License
            </Button>
          </VStack>
        </VStack>
      </Box>
    );
  }

  // License exists
  const isValid = status.valid;
  const isExpired = !isValid && status.hasLicense;

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      padding={6}
      width="full"
      maxWidth="600px"
    >
      <VStack align="start" gap={4}>
        <HStack>
          <Badge
            colorScheme={isValid ? "green" : "red"}
            fontSize="sm"
            paddingX={2}
            paddingY={1}
          >
            {isValid ? status.plan : isExpired ? "Expired" : "Invalid"}
          </Badge>
        </HStack>

        <VStack align="start" gap={2} width="full">
          {status.planName && (
            <HStack>
              <Text fontSize="sm" color="gray.500" width="100px">
                Plan:
              </Text>
              <Text fontSize="sm" fontWeight="medium">
                {status.planName}
              </Text>
            </HStack>
          )}

          {status.organizationName && (
            <HStack>
              <Text fontSize="sm" color="gray.500" width="100px">
                Licensed to:
              </Text>
              <Text fontSize="sm" fontWeight="medium">
                {status.organizationName}
              </Text>
            </HStack>
          )}

          {status.maxMembers !== undefined && (
            <HStack>
              <Text fontSize="sm" color="gray.500" width="100px">
                Members:
              </Text>
              <Text fontSize="sm" fontWeight="medium">
                {status.currentMembers ?? 0} / {status.maxMembers}
              </Text>
            </HStack>
          )}

          {status.expiresAt && (
            <HStack>
              <Text fontSize="sm" color="gray.500" width="100px">
                Expires:
              </Text>
              <Text
                fontSize="sm"
                fontWeight="medium"
                color={isExpired ? "red.500" : undefined}
              >
                {formatDate(status.expiresAt)}
              </Text>
            </HStack>
          )}
        </VStack>

        {!isValid && (
          <Box
            backgroundColor="red.50"
            padding={3}
            borderRadius="md"
            width="full"
          >
            <Text fontSize="sm" color="red.600">
              {isExpired
                ? "Your license has expired. Please renew to continue using licensed features, or remove to use unlimited mode."
                : "Your license is invalid. Please contact support or upload a valid license."}
            </Text>
          </Box>
        )}

        <HStack>
          <Button
            variant="outline"
            size="sm"
            colorScheme="red"
            onClick={handleRemove}
            loading={removeMutation.isLoading}
            disabled={removeMutation.isLoading}
          >
            Remove License
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}

function formatDate(isoDate: string): string {
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return isoDate;
  }
}
