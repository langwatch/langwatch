import {
  Box,
  Button,
  Flex,
  HStack,
  Link,
  Text,
  VisuallyHidden,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { explainAnyError } from "@langwatch/handled-error/presentation";
import { readEnvelopeTraceId, readHandledError } from "@langwatch/handled-error/read-handled-error";
import { AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";

const DEFAULT_FALLBACK_TITLE = "Couldn't load this chart";

/** The registry's copy for a failed panel; registered copy beats the caller's fallback. */
function chartErrorCopy({ error, fallbackTitle }: { error: unknown; fallbackTitle: string }) {
  const handled = readHandledError(error);
  const explanation = explainAnyError(error);
  return {
    title: explanation.isRegistered ? explanation.title : fallbackTitle,
    description: explanation.description,
    docsUrl: handled?.docsUrl,
    traceId: handled?.traceId || readEnvelopeTraceId(error),
  };
}

/**
 * A failed analytics panel: headline, one line of what to do, Retry and the error id. Never
 * `error.message` (the code slug, #5984), never the tips list (a dashboard can show a dozen
 * failed panels). For a tab header or a small card, use `ChartErrorIndicator`.
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
  const copy = chartErrorCopy({ error, fallbackTitle });

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
        {/* Inline icon: a narrow panel wraps the words under it instead of losing a column. */}
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
        {(copy.docsUrl ?? copy.traceId) && (
          <HStack gap={2} textStyle="xs" color="fg.subtle">
            {copy.docsUrl && (
              <Link href={copy.docsUrl} target="_blank" rel="noopener noreferrer">
                Docs
              </Link>
            )}
            {copy.traceId && <Text>Error ID: {copy.traceId}</Text>}
          </HStack>
        )}
      </VStack>
    </Flex>
  );
}

/**
 * The compact error state, for a figure in a tab header or a small summary card: a warning
 * icon and two words where the number would be, the registry's copy in a tooltip. It holds no
 * button, so it is safe inside a tab trigger; Retry lives in the panel body.
 */
export function ChartErrorIndicator({
  error,
  fallbackTitle = DEFAULT_FALLBACK_TITLE,
}: {
  error: unknown;
  fallbackTitle?: string;
}) {
  const copy = chartErrorCopy({ error, fallbackTitle });

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
