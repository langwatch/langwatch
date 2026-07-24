import { Box, Button, EmptyState, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";

export type GatewayErrorPanelProps = {
  title?: string;
  error?: { message?: string } | null;
  onRetry?: () => void;
};

/**
 * Renders a consistent error surface for gateway list pages when the
 * tRPC query fails (500, network blip, permission regression, etc).
 * Replaces the silent infinite-spinner anti-pattern where pages only
 * branch on isLoading and never surface isError to the operator.
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
