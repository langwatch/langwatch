/**
 * What a widget card shows in place of its chart when the chart would mislead: no traffic in
 * the period, a field its query needs that no trace carries, data the reader may not see, or a
 * failure it cannot draw past. The rules: features/dashboards/WIDGET_STANDARD.md.
 */

import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Lock, Plug, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

/**
 * The query found nothing in the board's period at all: "No traces in this period". On a board
 * that leaves Langy's traces out it says so, since they may be the rows the reader expected.
 */
export function WidgetNoTrafficFace({
  unit,
  langyLeftOut,
}: {
  unit: string;
  /** Set on a board that leaves Langy's traces out; `onInclude` where the reader may edit it. */
  langyLeftOut?: { onInclude?: () => void };
}) {
  return (
    <VStack height="full" justify="center" gap={1} paddingX={4}>
      <Text textStyle="bodySm" color="fg.muted">
        No {unit} in this period
      </Text>
      {langyLeftOut && (
        <Text textStyle="caption" color="fg.subtle">
          Langy traces are left out of this dashboard.
        </Text>
      )}
      {langyLeftOut?.onInclude && (
        <Button size="xs" variant="outline" marginTop={1} onClick={langyLeftOut.onInclude}>
          <Sparkles size={13} aria-hidden />
          Include Langy traces
        </Button>
      )}
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
        <Text textStyle="label">Needs {label}</Text>
      </HStack>
      <Text textStyle="caption" color="fg.muted">
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

/**
 * The reader's role may not see what the widget shows: what is withheld, and who to ask. It is
 * not a failure, so it has no warning colour and no Retry.
 */
export function WidgetNoAccessFace({ what, ask }: { what: string; ask: string }) {
  return (
    <VStack
      height="full"
      align="start"
      justify="center"
      gap={1.5}
      paddingX={4}
      data-widget-state="no_access"
    >
      <HStack gap={1.5}>
        <Box display="flex" color="fg.subtle">
          <Lock size={13} aria-hidden />
        </Box>
        <Text textStyle="label">{what}</Text>
      </HStack>
      <Text textStyle="caption" color="fg.muted">
        {ask}
      </Text>
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
      <Text textStyle="label">Couldn&apos;t load {name}</Text>
      {message && (
        <Text textStyle="caption" color="fg.muted" maxWidth="320px">
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
