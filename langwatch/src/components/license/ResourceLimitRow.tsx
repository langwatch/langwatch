import { HStack, Text } from "@chakra-ui/react";
import { formatResourceUsage } from "./licenseStatusUtils";

export interface ResourceLimitRowProps {
  label: string;
  current: number;
  max: number;
}

export function ResourceLimitRow({ label, current, max }: ResourceLimitRowProps) {
  return (
    <HStack width="full" justify="space-between">
      <Text fontSize="sm" color="fg.muted">
        {label}:
      </Text>
      <Text fontSize="sm" fontWeight="medium">
        {formatResourceUsage(current, max)}
      </Text>
    </HStack>
  );
}
