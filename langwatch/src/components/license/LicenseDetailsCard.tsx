import {
  Badge,
  Box,
  Button,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { LicenseStatus } from "../../../ee/licensing";
import { isLicenseExpired, formatLicenseDate, hasLicenseMetadata, isCorruptedLicense } from "./licenseStatusUtils";

interface LicenseDetailsCardProps {
  status: Extract<LicenseStatus, { hasLicense: true }>;
  onRemove: () => void;
  isRemoving: boolean;
}

export function LicenseDetailsCard({
  status,
  onRemove,
  isRemoving,
}: LicenseDetailsCardProps) {
  const isCorrupted = isCorruptedLicense(status);
  const isValid = status.valid;
  const isExpired = isLicenseExpired(status);

  if (isCorrupted) {
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
              colorScheme="red"
              fontSize="sm"
              paddingX={2}
              paddingY={1}
            >
              Corrupted
            </Badge>
          </HStack>

          <Box
            backgroundColor="red.50"
            padding={3}
            borderRadius="md"
            width="full"
          >
            <Text fontSize="sm" color="red.600">
              Your license file is corrupted and cannot be read. Please upload a
              valid license or contact support.
            </Text>
          </Box>

          <HStack>
            <Button
              variant="outline"
              size="sm"
              colorScheme="red"
              onClick={onRemove}
              loading={isRemoving}
              disabled={isRemoving}
            >
              Remove License
            </Button>
          </HStack>
        </VStack>
      </Box>
    );
  }

  if (!hasLicenseMetadata(status)) {
    return null;
  }

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
          <HStack>
            <Text fontSize="sm" color="gray.500" width="100px">
              Plan:
            </Text>
            <Text fontSize="sm" fontWeight="medium">
              {status.planName}
            </Text>
          </HStack>

          <HStack>
            <Text fontSize="sm" color="gray.500" width="100px">
              Licensed to:
            </Text>
            <Text fontSize="sm" fontWeight="medium">
              {status.organizationName}
            </Text>
          </HStack>

          <HStack>
            <Text fontSize="sm" color="gray.500" width="100px">
              Members:
            </Text>
            <Text fontSize="sm" fontWeight="medium">
              {status.currentMembers} / {status.maxMembers}
            </Text>
          </HStack>

          <HStack>
            <Text fontSize="sm" color="gray.500" width="100px">
              Expires:
            </Text>
            <Text
              fontSize="sm"
              fontWeight="medium"
              color={isExpired ? "red.500" : undefined}
            >
              {formatLicenseDate(status.expiresAt)}
            </Text>
          </HStack>
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
                ? "Your license has expired. Please renew to continue using licensed features."
                : "Your license is invalid. Please contact support or upload a valid license."}
            </Text>
          </Box>
        )}

        <HStack>
          <Button
            variant="outline"
            size="sm"
            colorScheme="red"
            onClick={onRemove}
            loading={isRemoving}
            disabled={isRemoving}
          >
            Remove License
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}
