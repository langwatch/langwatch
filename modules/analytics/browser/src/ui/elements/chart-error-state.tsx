import {
  Box,
  Button,
  Flex,
  HStack,
  Text,
  VisuallyHidden,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";

import { resolveErrorCopy } from "../../model/resolve-error-copy.ts";
import { ErrorActions } from "./error-actions.tsx";

const DEFAULT_FALLBACK_TITLE = "Couldn't load this chart";

/**
 * A failed panel, inside its own bounds: registry headline, one line of advice, Retry and the
 * error id. No tips list, since a dashboard can show a dozen failed panels at once. For a
 * figure in a tab header or a small card, use `ChartErrorIndicator`.
 */
export function ChartErrorState({
  error,
  onRetry,
  isRetrying = false,
  fallbackTitle = DEFAULT_FALLBACK_TITLE,
  minHeight,
}: {
  /** The panel query's error, passed straight through, handled or not. */
  error: unknown;
  onRetry: () => void;
  /** A retry is in flight: the Retry button shows a spinner. */
  isRetrying?: boolean;
  /** Headline for a failure the registry has no copy for. */
  fallbackTitle?: string;
  /** Keeps the panel at the height its content would have had. */
  minHeight?: string | number;
}) {
  const copy = resolveErrorCopy({ error, fallbackTitle });

  return (
    <Flex
      role="alert"
      width="full"
      minHeight={minHeight}
      align="center"
      justify="center"
      paddingX={4}
      paddingY={6}
    >
      <VStack gap={1.5} maxWidth="360px" textAlign="center" minWidth={0}>
        {/* The icon sits inline in the headline so a narrow panel wraps the
            words under it instead of losing a column to it. */}
        <Text textStyle="sm" fontWeight="medium" color="fg" lineClamp={3}>
          <Box
            as="span"
            display="inline-block"
            color="red.fg"
            verticalAlign="-2px"
            marginRight={1.5}
          >
            <AlertCircle size={14} aria-hidden="true" />
          </Box>
          {copy.title}
        </Text>
        {copy.description && (
          <Text textStyle="xs" color="fg.muted" lineClamp={3}>
            {copy.description}
          </Text>
        )}
        <Button size="xs" variant="outline" marginTop={1.5} onClick={onRetry} loading={isRetrying}>
          <RefreshCw size={12} aria-hidden="true" />
          Retry
        </Button>
        <ErrorActions docsUrl={copy.docsUrl} traceId={copy.traceId} />
      </VStack>
    </Flex>
  );
}

/**
 * The compact error state: an icon and "Couldn't load" where the number would be, the
 * registry copy and error id in a tooltip. No button, so it is safe inside a tab trigger;
 * Retry lives in the panel body (see `useRetryFailedAnalytics`).
 */
export function ChartErrorIndicator({
  error,
  fallbackTitle = DEFAULT_FALLBACK_TITLE,
}: {
  error: unknown;
  fallbackTitle?: string;
}) {
  const copy = resolveErrorCopy({ error, fallbackTitle });

  return (
    <Tooltip
      content={
        <VStack align="start" gap={1} paddingY={1}>
          <Text fontWeight="medium">{copy.title}</Text>
          {copy.description && <Text>{copy.description}</Text>}
          {copy.traceId && <Text opacity={0.75}>Error ID: {copy.traceId}</Text>}
        </VStack>
      }
    >
      <HStack
        as="span"
        data-testid="chart-error-indicator"
        gap={1.5}
        align="center"
        color="fg.muted"
        textStyle="sm"
        fontWeight="normal"
        lineHeight="short"
      >
        <Flex as="span" color="orange.fg" flexShrink={0}>
          <AlertTriangle size={14} aria-hidden="true" />
        </Flex>
        <span>Couldn't load</span>
        <VisuallyHidden>
          {copy.description ? `${copy.title}. ${copy.description}` : copy.title}
        </VisuallyHidden>
      </HStack>
    </Tooltip>
  );
}
