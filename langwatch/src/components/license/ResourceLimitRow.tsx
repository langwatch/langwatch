import { Text, VStack } from "@chakra-ui/react";
import { formatLimitOrUnlimited } from "./licenseStatusUtils";

export interface ResourceLimitRowProps {
  label: string;
  current: number;
  max?: number;
}

export function ResourceLimitRow({ label, current, max }: ResourceLimitRowProps) {
  return (
    <VStack
      align="start"
      gap={1}
      paddingY={4}
      paddingX={5}
      borderWidth="1px"
      borderColor="gray.100"
      borderRadius="lg"
      backgroundColor="gray.50"
    >
      <Text fontSize="xs" color="gray.500" fontWeight="medium" textTransform="uppercase" letterSpacing="wide">
        {label}
      </Text>
      <Text fontSize="xl" fontWeight="semibold" color="gray.900">
        {current.toLocaleString()}
        {max != null && (
          <Text as="span" fontSize="sm" fontWeight="normal" color="gray.400">
            {" "}/ {formatLimitOrUnlimited(max)}
          </Text>
        )}
      </Text>
    </VStack>
  );
}
