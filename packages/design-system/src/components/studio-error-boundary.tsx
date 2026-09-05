import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type * as React from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

/**
 * Private to `StudioDrawer`/`StudioDialog`. Mirrors the code-presence check
 * `explainAnyError` in workflow's (still feature-owned) studio-host error
 * shims does for a render-time crash: it reads a code if there is one, never
 * the presentation registry, which is the composing application's.
 */
function codeOfStudioError(error: unknown): string | undefined {
  const data = (error as { data?: { error?: { code?: unknown } } } | null)?.data?.error;
  return typeof data?.code === "string" ? data.code : undefined;
}

interface StudioIsolatedErrorBoundaryProps {
  /** Human-readable error label shown when the crash carries no code. */
  scope?: string;
  /**
   * Whether the raw crash message is shown under the heading. This package
   * cannot read the build, so the composing application says; production
   * otherwise, which is what a customer must never see internals through.
   */
  isDevelopment?: boolean;
  resetKeys?: ReadonlyArray<unknown>;
  onError?: (error: Error, info: { componentStack?: string | null }) => void;
  children: React.ReactNode;
}

/**
 * Wraps children so a render-time crash renders an inline error panel
 * instead of closing the surrounding drawer/dialog or unmounting siblings.
 */
export const StudioIsolatedErrorBoundary: React.FC<StudioIsolatedErrorBoundaryProps> = ({
  scope,
  isDevelopment = false,
  resetKeys,
  onError,
  children,
}) => (
  <ErrorBoundary
    FallbackComponent={(props) => (
      <InlineError {...props} scope={scope} isDevelopment={isDevelopment} />
    )}
    resetKeys={resetKeys ? [...resetKeys] : undefined}
    onError={(error, info) => {
      // eslint-disable-next-line no-console
      console.error("[StudioIsolatedErrorBoundary]", scope ?? "(no scope)", error);
      onError?.(error as Error, info);
    }}
  >
    {children}
  </ErrorBoundary>
);

const InlineError: React.FC<FallbackProps & { scope?: string; isDevelopment: boolean }> = ({
  error,
  resetErrorBoundary,
  scope,
  isDevelopment,
}) => {
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
