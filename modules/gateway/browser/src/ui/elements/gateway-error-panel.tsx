import { Box, Button, EmptyState, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";

export type GatewayErrorPanelProps = {
  title?: string;
  error?: { message?: string } | null;
  onRetry?: () => void;
};

/**
 * A consistent error surface for gateway list pages when the tRPC query
 * fails. Replaces the silent infinite-spinner anti-pattern where a page
 * branches on isLoading and never surfaces isError to the operator.
 */
export function GatewayErrorPanel({
  title = "Failed to load data",
  error,
  onRetry,
}: GatewayErrorPanelProps) {
  const message =
    error?.message?.trim() ||
    "The request failed unexpectedly. Please try again or check the server logs.";
  return (
    <Box paddingY={12}>
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <AlertTriangle size={32} color="var(--chakra-colors-red-500)" />
          </EmptyState.Indicator>
          <VStack gap={2} textAlign="center" maxWidth="420px">
            <EmptyState.Title>{title}</EmptyState.Title>
            <Text fontSize="sm" color="fg.muted">
              {message}
            </Text>
            {onRetry && (
              <Button
                size="sm"
                variant="outline"
                colorPalette="orange"
                onClick={onRetry}
                marginTop={2}
              >
                Retry
              </Button>
            )}
          </VStack>
        </EmptyState.Content>
      </EmptyState.Root>
    </Box>
  );
}
