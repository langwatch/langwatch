import { Box, Button, HStack, VStack } from "@chakra-ui/react";
import { RefreshCw } from "react-feather";

import { HandledErrorAlert } from "~/features/errors";

/**
 * Full-area error state for analytics charts.
 *
 * Replaces chart content when a query fails, providing the registry's copy for
 * the failure (headline, what to do about it, remediation tips, docs link and
 * a copyable error id) plus a retry button. It deliberately shows no raw
 * backend message: since #5984 that string is the error's code slug, and
 * anything a customer can act on already comes through the handled payload.
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
        <HandledErrorAlert
          error={error}
          fallbackTitle="Failed to load chart data"
        />
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
