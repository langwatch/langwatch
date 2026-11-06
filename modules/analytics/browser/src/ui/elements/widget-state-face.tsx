/**
 * What a widget card shows in place of its chart when the chart would mislead or is not there
 * yet: loading, no traffic, a field no trace carries, data the reader may not see, or a failure
 * it cannot draw past. The rules: features/dashboards/WIDGET_STANDARD.md.
 */

import {
  Box,
  Button,
  HStack,
  Skeleton,
  Text,
  VisuallyHidden,
  VStack,
} from "@langwatch/design-system/primitives";
import { ArrowRight, Code2, Lock, Plug, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

/** The widget's queries have not answered yet: a chart-shaped skeleton, and words when slow. */
export function WidgetLoadingFace({ slow }: { slow: boolean }) {
  // The skeleton is busy; the words sit outside it so screen readers still announce them.
  return (
    <VStack
      height="full"
      align="stretch"
      justify="center"
      gap={3}
      padding={4}
      data-widget-state="loading"
    >
      <VStack align="stretch" gap={3} flex={1} justify="center" aria-busy="true">
        <Skeleton height="20px" width="30%" aria-hidden />
        <Skeleton flex={1} maxHeight="160px" aria-hidden />
      </VStack>
      <output>
        {slow ? (
          <Text textStyle="caption" color="fg.muted" textAlign="center">
            Still loading…
          </Text>
        ) : (
          <VisuallyHidden>Loading</VisuallyHidden>
        )}
      </output>
    </VStack>
  );
}

/**
 * The query found nothing in the board's period at all: "No traces in this period", then what
 * sends that data and its setup step, when the widget has words for them.
 */
export function WidgetNoTrafficFace({
  unit,
  guidance,
  onSetUp,
}: {
  unit: string;
  /** What sends the data, "Send traces with the LangWatch SDK to fill this widget." */
  guidance?: string;
  /** The setup step's button, when the project has one to take. */
  onSetUp?: { label: string; onClick: () => void };
}) {
  return (
    <VStack height="full" justify="center" gap={1.5} paddingX={4} textAlign="center">
      <Text textStyle="bodySm" color="fg.muted">
        No {unit} in this period
      </Text>
      {guidance && (
        <Text textStyle="caption" color="fg.muted" maxWidth="320px">
          {guidance}
        </Text>
      )}
      {onSetUp && (
        <Button size="xs" variant="outline" marginTop={1.5} onClick={onSetUp.onClick}>
          {onSetUp.label}
          <ArrowRight size={13} aria-hidden />
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
  guidance,
  onAskLangy,
}: {
  /** The field's plain words, "total cost". */
  label: string;
  /** What the query counts, "traces". */
  unit: string;
  /** What sends the field, "Send user_id in the trace metadata with the LangWatch SDK." */
  guidance?: string;
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
      {guidance && (
        <Text textStyle="caption" color="fg.muted">
          {guidance}
        </Text>
      )}
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

// Narrow or short cards drop the spacing and the button icons so the face still fits.
const TIGHT_FACE = "@container (max-width: 340px) or (max-height: 150px)";

/**
 * Says the widget couldn't load and why, and offers Retry; the card's title names it. A limit
 * failure may add a note and the edit actions, and then Retry steps back.
 */
export function WidgetFailedFace({
  message,
  note,
  onRetry,
  onEditWithLangy,
  onEditCode,
  minorRetry = false,
}: {
  /** The error registry's words for what went wrong. */
  message?: string;
  /** A further line, such as who to ask when the reader cannot edit. */
  note?: string | undefined;
  onRetry: () => void;
  onEditWithLangy?: (() => void) | undefined;
  onEditCode?: (() => void) | undefined;
  /** Retry is the lesser action, not the fix. */
  minorRetry?: boolean;
}) {
  return (
    <VStack
      height="full"
      justify="center"
      gap={2}
      paddingX={4}
      textAlign="center"
      css={{ [TIGHT_FACE]: { gap: 1.5, paddingX: 2 } }}
    >
      <VStack gap={2} flexShrink={0} css={{ [TIGHT_FACE]: { flexDirection: "row", gap: 1.5 } }}>
        <Box display="flex" color="fg.error">
          <TriangleAlert size={18} aria-hidden />
        </Box>
        <Text textStyle="label">Couldn&apos;t load</Text>
      </VStack>
      {(message || note) && (
        <VStack gap={1.5} flexShrink={1} minHeight={0} overflow="hidden">
          {message && (
            <Text
              textStyle="caption"
              color="fg.muted"
              maxWidth="320px"
              lineClamp={3}
              title={message}
            >
              {message}
            </Text>
          )}
          {note && (
            <Text textStyle="caption" color="fg.muted" maxWidth="320px" lineClamp={2} title={note}>
              {note}
            </Text>
          )}
        </VStack>
      )}
      <HStack
        gap={1.5}
        justify="center"
        wrap="wrap"
        marginTop={1}
        flexShrink={0}
        css={{ [TIGHT_FACE]: { marginTop: 0, "& svg": { display: "none" } } }}
      >
        {onEditWithLangy && (
          <Button size="xs" variant="outline" onClick={onEditWithLangy}>
            <Sparkles size={13} aria-hidden />
            Edit with Langy
          </Button>
        )}
        {onEditCode && (
          <Button size="xs" variant="outline" onClick={onEditCode}>
            <Code2 size={13} aria-hidden />
            Edit code
          </Button>
        )}
        <Button size="xs" variant={minorRetry ? "ghost" : "outline"} onClick={onRetry}>
          <RotateCcw size={13} aria-hidden />
          Retry
        </Button>
      </HStack>
    </VStack>
  );
}
