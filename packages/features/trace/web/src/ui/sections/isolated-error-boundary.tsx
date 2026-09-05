import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type * as React from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

import { useUiDeployment } from "@langwatch/ui-host/capabilities";

import { explainAnyError } from "./errors";

interface IsolatedErrorBoundaryProps {
  /**
   * Human-readable error label. Defaults to "Something went wrong" — pass a
   * more specific scope like "Couldn't load this trace" for trace drawers,
   * "This evaluation failed to render" for evaluator cards, etc.
   */
  scope?: string;
  /**
   * Reset keys — when any change, the boundary remounts its children.
   */
  resetKeys?: ReadonlyArray<unknown>;
  /**
   * Optional telemetry hook — fires once on each caught error before the
   * fallback renders. Wire to PostHog/Sentry/etc. at the call site so the
   * boundary itself stays UI-only.
   */
  onError?: (error: Error, info: { componentStack?: string | null }) => void;
  children: React.ReactNode;
}

/**
 * Wraps children so a render-time crash inside renders an inline error panel — without
 * closing the surrounding drawer/dialog or unmounting siblings.
 */
export const IsolatedErrorBoundary: React.FC<IsolatedErrorBoundaryProps> = ({
  scope,
  resetKeys,
  onError,
  children,
}) => (
  <ErrorBoundary
    FallbackComponent={(props) => <InlineError {...props} scope={scope} />}
    resetKeys={resetKeys ? [...resetKeys] : undefined}
    onError={(error, info) => {
      // Default-log so dev tooling and any session-replay / log scraper
      // catch it even when no explicit telemetry hook is wired.
      // eslint-disable-next-line no-console
      console.error("[IsolatedErrorBoundary]", scope ?? "(no scope)", error);
      onError?.(error as Error, info);
    }}
  >
    {children}
  </ErrorBoundary>
);

const InlineError: React.FC<FallbackProps & { scope?: string }> = ({
  error,
  resetErrorBoundary,
  scope,
}) => {
  // This is the fallback for every drawer and dialog in the app, so whatever it prints,
  // a customer reads — in production.
  const explanation = explainAnyError(error);
  // A render crash almost never carries a handled payload, so the registry's
  // headline is usually the generic one — and the caller's `scope` ("Couldn't
  // load this trace") names the surface that broke, which is more use.
  const heading = explanation.isRegistered ? explanation.title : (scope ?? explanation.title);
  const isDev = useUiDeployment().isDevelopment;
  const rawMessage = error instanceof Error ? error.message : String(error);

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
        {explanation.description && (
          <Text textStyle="2xs" color="fg.muted">
            {explanation.description}
          </Text>
        )}
        {isDev && (
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
