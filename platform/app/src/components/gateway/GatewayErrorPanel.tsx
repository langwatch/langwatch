import { Box, Button, EmptyState, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle } from "lucide-react";
import {
  isPermissionRefusal,
  PermissionRefusedNotice,
} from "~/components/PermissionRequiredNotice";

export type GatewayErrorPanelProps = {
  title?: string;
  error?: { message?: string } | null;
  onRetry?: () => void;
};

/**
 * Renders a consistent error surface for gateway list pages when the
 * tRPC query fails (500, network blip, etc), so a page never sits on a
 * spinner for a query that already failed.
 *
 * A refusal for a grant the viewer does not hold is not a failed load:
 * retrying cannot change it, so it renders as a no-access notice naming the
 * grant, with no retry.
 */
export function GatewayErrorPanel({
  title = "Failed to load data",
  error,
  onRetry,
}: GatewayErrorPanelProps) {
  if (isPermissionRefusal(error)) {
    return (
      <Box paddingY={6}>
        <PermissionRefusedNotice error={error} />
      </Box>
    );
  }
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
