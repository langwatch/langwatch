import { Box, Button, EmptyState, Text, VStack } from "@langwatch/design-system/primitives";
import { AlertTriangle } from "lucide-react";

import { isPermissionRefusal } from "../../model/permission-refusal.ts";
import { PermissionRefusedNotice } from "./permission-required-notice.tsx";

export type GatewayErrorPanelProps = {
  title?: string;
  /** Whatever the failed query carried: a tRPC client error, an Error, or nothing. */
  error?: unknown;
  onRetry?: () => void;
};

function readMessage(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message.trim() : "";
}

/**
 * The error surface for a gateway list page whose query failed, so it never spins on a dead query.
 * A refusal for a missing grant is not a failed load: retrying cannot change it, so it renders as
 * a no-access notice naming the grant, with no retry.
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
    readMessage(error) ||
    "The request failed unexpectedly. Please try again or check the server logs.";
  return (
    <Box paddingY={12}>
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <AlertTriangle size={32} color="var(--chakra-colors-fg-error)" />
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
