import {
  Box,
  Button,
  Flex,
  HStack,
  Text,
  VisuallyHidden,
  VStack,
} from "@chakra-ui/react";
import { AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";

import { resolveErrorCopy } from "~/features/errors";
import { ErrorActions } from "~/features/errors/components/ErrorActions";

import { Tooltip } from "../ui/tooltip";

const DEFAULT_FALLBACK_TITLE = "Couldn't load this chart";

/**
 * The error state of an analytics panel whose query failed.
 *
 * It takes the panel's place and stays inside it: a headline, one short line
 * of what to do, a Retry, and the error id as a small copy action. The words
 * come from the code-keyed registry, never from `error.message` (since #5984
 * that is the code slug). The server's remediation tips are left out on
 * purpose: a dashboard can show a dozen failed panels at once, and a tips
 * list in each one buries the page.
 *
 * For a panel too small to hold this, or one drawn inside a control such as a
 * tab header, use `ChartErrorIndicator`.
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
        <Button
          size="xs"
          variant="outline"
          marginTop={1.5}
          onClick={onRetry}
          loading={isRetrying}
        >
          <RefreshCw size={12} aria-hidden="true" />
          Retry
        </Button>
        <ErrorActions docsUrl={copy.docsUrl} traceId={copy.traceId} />
      </VStack>
    </Flex>
  );
}

/**
 * The compact error state, for a figure in a tab header or a small summary
 * card: a warning icon and two words in the space the number would take, with
 * the registry's explanation and the error id in a tooltip.
 *
 * It holds no button, so it is safe inside a tab trigger. Retry lives in the
 * panel body (see `useRetryFailedAnalytics`).
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
