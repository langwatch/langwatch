import { Box, Button, HStack, VStack } from "@chakra-ui/react";
import { RefreshCw } from "react-feather";

import { HandledErrorAlert } from "./handled-error-alert.tsx";

/**
 * Full-area error state for analytics charts: the registry's copy (headline, remediation,
 * docs link, error id) plus a retry button. It deliberately shows no raw backend message —
 * since #5984 that string is only the error's code slug, not something a customer can act on.
 */
export function ChartErrorState({
  error,
  onRetry,
}: {
  /** The chart query's error, passed straight through — handled or not. */
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Box
      position="absolute"
      inset={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={1}
    >
      <VStack gap={3} align="stretch" maxWidth="sm" width="fit-content">
        <HandledErrorAlert error={error} fallbackTitle="Failed to load chart data" />
        <HStack gap={2}>
          <Button size="xs" variant="outline" onClick={onRetry}>
            <RefreshCw size={12} />
            Retry
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
}
