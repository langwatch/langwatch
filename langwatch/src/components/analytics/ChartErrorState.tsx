import {
  Alert,
  Box,
  Button,
  Collapsible,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, RefreshCw } from "react-feather";

/**
 * Full-area error state for analytics charts.
 *
 * Replaces chart content when a query fails, providing:
 * - a prominent centered error message
 * - a retry button
 * - an expandable section showing the backend error details
 */
export function ChartErrorState({
  errorMessage,
  onRetry,
}: {
  errorMessage: string;
  onRetry: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <Box
      position="absolute"
      inset={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      zIndex={1}
    >
      <Alert.Root
        status="error"
        borderStartWidth="4px"
        borderStartColor="red.500"
        maxWidth="sm"
        width="fit-content"
      >
        <VStack gap={3} align="stretch" width="full">
          <HStack gap={2}>
            <AlertCircle size={18} />
            <Text fontWeight="semibold" fontSize="sm">
              Failed to load chart data
            </Text>
          </HStack>

          <HStack gap={2}>
            <Button size="xs" variant="outline" onClick={onRetry}>
              <RefreshCw size={12} />
              Retry
            </Button>
          </HStack>

          <Collapsible.Root
            open={detailsOpen}
            onOpenChange={({ open }) => setDetailsOpen(open)}
          >
            <Collapsible.Trigger asChild>
              <HStack gap={1} cursor="pointer">
                {detailsOpen ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                <Text fontSize="xs" color="fg.muted">
                  Show details
                </Text>
              </HStack>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <Box
                marginTop={2}
                padding={2}
                borderRadius="sm"
                backgroundColor="bg.subtle"
                fontSize="xs"
                fontFamily="mono"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
              >
                {errorMessage}
              </Box>
            </Collapsible.Content>
          </Collapsible.Root>
        </VStack>
      </Alert.Root>
    </Box>
  );
}
