/**
 * What a widget card shows in place of its chart when the chart would mislead: no traffic in
 * the period, a field its query needs that no trace carries, or a failure it cannot draw past.
 * The rules: features/dashboards/WIDGET_STANDARD.md.
 */

import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Plug, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

/** The query found nothing in the board's period at all: "No traces in this period". */
export function WidgetNoTrafficFace({ unit }: { unit: string }) {
  return (
    <VStack height="full" justify="center" paddingX={4}>
      <Text fontSize="12.5px" color="fg.muted">
        No {unit} in this period
      </Text>
    </VStack>
  );
}

/**
 * The setup view: the field the query found on no trace, in plain words, and Langy to help
 * send it when the card offers that.
 */
export function WidgetSetupFace({
  label,
  unit,
  onAskLangy,
}: {
  /** The field's plain words, "total cost". */
  label: string;
  /** What the query counts, "traces". */
  unit: string;
  onAskLangy?: () => void;
}) {
  return (
    <VStack height="full" align="start" justify="center" gap={1.5} paddingX={4}>
      <HStack gap={1.5}>
        <Box display="flex" color="fg.subtle">
          <Plug size={13} aria-hidden />
        </Box>
        <Text fontSize="12.5px" fontWeight="medium">
          Needs {label}
        </Text>
      </HStack>
      <Text fontSize="12px" color="fg.muted">
        None of the {unit} in this period have it.
      </Text>
      {onAskLangy && (
        <Button size="xs" variant="outline" marginTop={1.5} onClick={onAskLangy}>
          <Sparkles size={13} aria-hidden />
          Ask Langy to help
        </Button>
      )}
    </VStack>
  );
}

/** Names the widget that failed and offers Retry, so a reader knows which card to try again. */
export function WidgetFailedFace({
  name,
  message,
  onRetry,
}: {
  name: string;
  /** The error registry's words for what went wrong. */
  message?: string;
  onRetry: () => void;
}) {
  return (
    <VStack height="full" justify="center" gap={2} paddingX={4} textAlign="center">
      <Box display="flex" color="fg.error">
        <TriangleAlert size={18} aria-hidden />
      </Box>
      <Text fontSize="13px" fontWeight="medium">
        Couldn&apos;t load {name}
      </Text>
      {message && (
        <Text fontSize="11.5px" color="fg.muted" maxWidth="320px">
          {message}
        </Text>
      )}
      <Button size="xs" variant="outline" marginTop={1} onClick={onRetry}>
        <RotateCcw size={13} aria-hidden />
        Retry
      </Button>
    </VStack>
  );
}
