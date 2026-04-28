import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import * as React from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";

interface IsolatedErrorBoundaryProps {
  /**
   * Human-readable error label. Defaults to "Something went wrong" — pass a
   * more specific scope like "Couldn't load this trace" for trace drawers,
   * "This evaluation failed to render" for evaluator cards, etc.
   */
  scope?: string;
  /**
   * Reset keys — when any change, the boundary remounts its children.
   * Same semantics as `react-error-boundary`'s built-in: feed the IDs the
   * inner content depends on so navigating to a different trace/span
   * re-attempts rendering instead of staying stuck on the error.
   */
  resetKeys?: ReadonlyArray<unknown>;
  children: React.ReactNode;
}

/**
 * Wraps children so a render-time crash inside renders an inline error
 * panel — without closing the surrounding drawer/dialog or unmounting
 * siblings. Used by default inside `DrawerContent` and `DialogContent`
 * so any drawer/dialog body that throws shows the error in place rather
 * than taking down the whole page.
 */
export const IsolatedErrorBoundary: React.FC<IsolatedErrorBoundaryProps> = ({
  scope,
  resetKeys,
  children,
}) => (
  <ErrorBoundary
    FallbackComponent={(props) => <InlineError {...props} scope={scope} />}
    resetKeys={resetKeys ? [...resetKeys] : undefined}
  >
    {children}
  </ErrorBoundary>
);

const InlineError: React.FC<FallbackProps & { scope?: string }> = ({
  error,
  resetErrorBoundary,
  scope,
}) => {
  const message = error instanceof Error ? error.message : String(error);
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
            {scope ?? "Something went wrong"}
          </Text>
        </HStack>
        <Text
          textStyle="2xs"
          color="fg.muted"
          fontFamily="mono"
          maxHeight="120px"
          overflowY="auto"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {message || "No error message"}
        </Text>
        <HStack justify="flex-end">
          <Button
            size="xs"
            variant="outline"
            colorPalette="red"
            onClick={resetErrorBoundary}
          >
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
