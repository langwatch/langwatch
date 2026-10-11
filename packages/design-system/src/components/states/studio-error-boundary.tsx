import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type * as React from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

import { useIsDevelopment } from "../../provider/environment.ts";

/**
 * Private to the overlay error boundary. Reads a code if there is one for
 * a render-time crash, never the presentation registry, which is the
 * composing application's.
 */
function codeOfStudioError(error: unknown): string | undefined {
  const data = (error as { data?: { error?: { code?: unknown } } } | null)?.data?.error;
  return typeof data?.code === "string" ? data.code : undefined;
}

interface StudioIsolatedErrorBoundaryProps {
  /** Human-readable error label shown when the crash carries no code. */
  scope?: string;
  /** Overrides the provider's `isDevelopment`: whether the raw crash message shows. */
  isDevelopment?: boolean;
  resetKeys?: readonly unknown[];
  /** A control the fallback offers beside "Try again": a legacy Content's close. */
  recovery?: React.ReactNode;
  onError?: (error: Error, info: { componentStack?: string | null }) => void;
  children: React.ReactNode;
}

/**
 * Wraps children so a render-time crash renders an inline error panel
 * instead of closing the surrounding drawer/dialog or unmounting siblings.
 */
export const StudioIsolatedErrorBoundary: React.FC<StudioIsolatedErrorBoundaryProps> = ({
  scope,
  isDevelopment: isDevelopmentOverride,
  resetKeys,
  recovery,
  onError,
  children,
}) => {
  const fromProvider = useIsDevelopment();
  const isDevelopment = isDevelopmentOverride ?? fromProvider;
  return (
    <ErrorBoundary
      FallbackComponent={(props) => (
        <InlineError {...props} scope={scope} isDevelopment={isDevelopment} recovery={recovery} />
      )}
      resetKeys={resetKeys ? [...resetKeys] : undefined}
      onError={(error, info) => {
        console.error("[StudioIsolatedErrorBoundary]", scope ?? "(no scope)", error);
        onError?.(error as Error, info);
      }}
    >
      {children}
    </ErrorBoundary>
  );
};

const InlineError: React.FC<
  FallbackProps & { scope?: string; isDevelopment: boolean; recovery?: React.ReactNode }
> = ({ error, resetErrorBoundary, scope, isDevelopment, recovery }) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const isRegistered = codeOfStudioError(error) !== undefined;
  const heading = isRegistered ? "Something went wrong" : (scope ?? "Something went wrong");

  return (
    <Box
      role="alert"
      paddingX={4}
      paddingY={3}
      margin={3}
      borderWidth="1px"
      borderColor="red.muted"
      borderRadius="md"
      bg="red.subtle"
      maxWidth="full"
    >
      <VStack align="stretch" gap={2}>
        <HStack gap={2}>
          <Icon color="red.fg" boxSize="14px">
            <AlertTriangle />
          </Icon>
          <Text textStyle="xs" fontWeight="semibold" color="red.fg">
            {heading}
          </Text>
        </HStack>
        <Text textStyle="2xs" color="fg.muted">
          We've been notified. Try again in a moment.
        </Text>
        {isDevelopment && (
          <Text
            textStyle="2xs"
            color="fg.muted"
            fontFamily="mono"
            maxHeight="120px"
            overflowY="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {rawMessage || "No error message"}
          </Text>
        )}
        <HStack justify="flex-end">
          {recovery}
          <Button size="xs" variant="outline" colorPalette="red" onClick={resetErrorBoundary}>
            <Icon boxSize="12px">
              <RotateCcw />
            </Icon>
            Try again
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};
