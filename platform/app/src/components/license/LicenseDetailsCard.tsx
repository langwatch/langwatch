import {
  Badge,
  Box,
  Button,
  HStack,
  Link,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { LicenseStatus } from "../../../ee/licensing/client";
import { CONTACT_SALES_URL } from "../../../ee/licensing/constants";
import {
  formatLicenseDate,
  hasLicenseMetadata,
  isCorruptedLicense,
  isLicenseExpired,
} from "./licenseStatusUtils";

interface LicenseDetailsCardProps {
  status: Extract<LicenseStatus, { hasLicense: true }>;
  onRemove: () => void;
  isRemoving: boolean;
}

/**
 * The one word that tells an admin where they stand. A lapsed license is orange
 * rather than red: it still meters the seats it sold and every capability keeps
 * working, so it asks for attention rather than reporting a breakage.
 */
function LicenseStateBadge({
  isValid,
  isExpired,
  plan,
}: {
  isValid: boolean;
  isExpired: boolean;
  plan: string;
}) {
  const { label, colorPalette } = isValid
    ? { label: plan, colorPalette: "green" }
    : isExpired
      ? { label: "Expired", colorPalette: "orange" }
      : { label: "Invalid", colorPalette: "red" };

  return (
    <Badge colorPalette={colorPalette} fontSize="sm" paddingX={2} paddingY={1}>
      {label}
    </Badge>
  );
}

/**
 * What a lapse actually changed, which is almost nothing. Naming the seat count
 * here is the point: it is the number that keeps binding, and the only thing
 * renewal buys back is room above it.
 */
function LapsedLicenseNotice({ maxMembers }: { maxMembers: number }) {
  return (
    <Box
      backgroundColor="orange.50"
      padding={3}
      borderRadius="md"
      width="full"
      _dark={{ backgroundColor: "orange.950" }}
    >
      <Text fontSize="sm" color="orange.700" _dark={{ color: "orange.200" }}>
        Your license reached its end date. Nothing was switched off: everyone
        keeps their access and your {maxMembers}{" "}
        {maxMembers === 1 ? "seat" : "seats"} and enterprise capabilities stay
        as they are. Renew to add members again.
      </Text>
    </Box>
  );
}

/** A license whose signature does not check out. Its numbers mean nothing. */
function InvalidLicenseNotice() {
  return (
    <Box backgroundColor="red.50" padding={3} borderRadius="md" width="full">
      <Text fontSize="sm" color="red.600">
        Your license is invalid. Please contact support or upload a valid
        license.
      </Text>
    </Box>
  );
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
      <Box borderWidth="1px" borderRadius="lg" padding={6} width="full">
        <VStack align="start" gap={4}>
          <HStack>
            <Badge colorPalette="red" fontSize="sm" paddingX={2} paddingY={1}>
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
              colorPalette="red"
              onClick={onRemove}
              loading={isRemoving}
              disabled={isRemoving}
            >
              Remove License
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={CONTACT_SALES_URL} target="_blank">
                Contact Sales
              </Link>
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
    <Box borderWidth="1px" borderRadius="lg" padding={6} width="full">
      <VStack align="start" gap={4}>
        <HStack>
          <LicenseStateBadge
            isValid={isValid}
            isExpired={isExpired}
            plan={status.plan}
          />
        </HStack>

        <VStack align="start" gap={2} width="full">
          <HStack>
            <Text fontSize="sm" color="fg.muted" width="120px">
              Plan:
            </Text>
            <Text fontSize="sm" fontWeight="medium">
              {status.planName}
            </Text>
          </HStack>

          <HStack>
            <Text fontSize="sm" color="fg.muted" width="120px">
              Licensed to:
            </Text>
            <Text fontSize="sm" fontWeight="medium">
              {status.organizationName}
            </Text>
          </HStack>

          <HStack>
            <Text fontSize="sm" color="fg.muted" width="120px">
              Seats:
            </Text>
            <Text fontSize="sm" fontWeight="medium">
              {status.currentMembers} / {status.maxMembers}
            </Text>
          </HStack>

          <HStack>
            <Text fontSize="sm" color="fg.muted" width="120px">
              Expires:
            </Text>
            <Text
              fontSize="sm"
              fontWeight="medium"
              color={isExpired ? "orange.600" : undefined}
            >
              {formatLicenseDate(status.expiresAt)}
            </Text>
          </HStack>
        </VStack>

        {isExpired && <LapsedLicenseNotice maxMembers={status.maxMembers} />}

        {!isValid && !isExpired && <InvalidLicenseNotice />}

        <HStack>
          <Button
            variant="outline"
            size="sm"
            colorPalette="red"
            onClick={onRemove}
            loading={isRemoving}
            disabled={isRemoving}
          >
            Remove License
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={CONTACT_SALES_URL} target="_blank">
              Contact Sales
            </Link>
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}
