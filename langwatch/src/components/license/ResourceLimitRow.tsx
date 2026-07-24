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
      borderColor="border"
      borderRadius="lg"
      bg="bg.subtle"
    >
      <Text fontSize="xs" color="fg.muted" fontWeight="medium" textTransform="uppercase" letterSpacing="wide">
        {label}
      </Text>
      <Text fontSize="xl" fontWeight="semibold" color="fg">
        {current.toLocaleString()}
        {max != null && (
          <Text as="span" fontSize="sm" fontWeight="normal" color="fg.muted">
            {" "}/ {formatLimitOrUnlimited(max)}
          </Text>
        )}
      </Text>
    </VStack>
  );
}
