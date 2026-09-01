import { Box, Text, VStack } from "@chakra-ui/react";
import { ManagerCard, type DejaViewProcessManager } from "./deja-view-manager-card";

export function DejaViewManagerPanel({
  managers,
  isLoading,
  errorMessage,
}: {
  managers: DejaViewProcessManager[];
  isLoading: boolean;
  errorMessage: string | null;
}) {
  if (isLoading) {
    return null;
  }

  if (!errorMessage && managers.length === 0) {
    return null;
  }

  return (
    <Box
      width="360px"
      minWidth="360px"
      borderLeft="1px solid"
      borderLeftColor="border"
      overflowY="auto"
      bg="bg.surface"
    >
      <Box paddingX={3} paddingY={2} borderBottom="1px solid" borderBottomColor="border">
        <Text
          textStyle="xs"
          fontWeight="semibold"
          color="fg.muted"
          textTransform="uppercase"
          letterSpacing="wider"
        >
          Process Managers
        </Text>
      </Box>
      {errorMessage ? (
        <Box paddingX={3} paddingY={4}>
          <Text textStyle="xs" color="red.500">
            {errorMessage}
          </Text>
        </Box>
      ) : (
        <VStack align="stretch" gap={3} padding={3}>
          {managers.map((manager) => (
            <ManagerCard key={manager.processName} manager={manager} />
          ))}
        </VStack>
      )}
    </Box>
  );
}
