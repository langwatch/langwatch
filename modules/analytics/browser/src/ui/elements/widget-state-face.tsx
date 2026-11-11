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

// Narrow or short cards drop the title row's spacing so the face still fits.
const TIGHT_FACE = "@container (width <= 340px) or (height <= 157px)";
// A clamp counts lines, not height, so each band sets a count its height holds: 158 leaves 102px
// for text; 98 leaves 46, or 18 under two rows of buttons. Chakra re-sorts container queries, so
// bands must not overlap on one property.
const NARROW_FACE = "@container (width <= 340px) and (height > 157px)";
const SHORT_FACE = "@container (height <= 157px)";
const SHORT_WIDE_FACE = "@container (width > 240px) and (height <= 157px)";
const SHORT_SMALL_FACE = "@container (width <= 240px) and (height <= 157px)";
// Wide and 158 to 177 high, five lines need 80px and the default 68 slices the fifth, so four;
// five show from 178 high, with a margin.
const MID_WIDE_FACE = "@container (width > 340px) and (height > 157px) and (height <= 177px)";
// Tall cards have the room to show a long message whole.
const TALL_FACE = "@container (height >= 278px)";

// Clipped away but still read by screen readers, so the full words stay the accessible name.
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
} as const;
const SHORT_WORDS_ONLY_HERE = {
  "& [data-short-words]": { display: "inline" },
  "& [data-full-words]": VISUALLY_HIDDEN,
} as const;
const HIDE_SHORT_WORDS = { "& [data-short-words]": { display: "none" } } as const;

/** The full words, plus the short ones the smallest cards show instead (hidden from readers). */
function Words({ full, short }: { full: string; short?: string | undefined }) {
  if (!short) return full;
  return (
    <>
      <span data-full-words>{full}</span>
      <span data-short-words aria-hidden>
        {short}
      </span>
    </>
  );
}

/**
 * Says the widget couldn't load and why, and offers Retry; the card's title names it. A limit
 * failure may add a note or the edit actions; beside an edit action, Retry steps back.
 */
export function WidgetFailedFace({
  message,
  note,
  shortMessage,
  shortNote,
  editsDisabled,
  onRetry,
  onEditWithLangy,
  onEditCode,
}: {
  /** The error registry's words for what went wrong. */
  message?: string;
  /** A further line, such as who to ask when the reader cannot edit. */
  note?: string | undefined;
  /** One line shown in place of `message` on the smallest cards; `message` stays the title. */
  shortMessage?: string | undefined;
  /** One line shown in place of `note` on the smallest cards; `note` stays the title. */
  shortNote?: string | undefined;
  /** Disables the edit actions while a board write runs; Retry stays live. */
  editsDisabled?: boolean | undefined;
  onRetry: () => void;
  onEditWithLangy?: (() => void) | undefined;
  onEditCode?: (() => void) | undefined;
}) {
  const hasEdits = Boolean(onEditWithLangy || onEditCode);
  // Only the edit row needs the room; Retry alone keeps its icon.
  const tightIcons = hasEdits ? { "& svg": { display: "none" } } : {};
  return (
    <VStack
      height="full"
      justify="center"
      gap={2}
      paddingX={4}
      textAlign="center"
      css={{
        [NARROW_FACE]: { gap: 1.5, paddingX: 2 },
        [SHORT_FACE]: { gap: 1, paddingX: 2 },
      }}
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
              lineClamp={note ? 3 : 5}
              flexShrink={0}
              title={message}
              css={{
                // The side padding keeps the clamp's last dot clear of the clipped edge.
                paddingInline: "2px",
                ...HIDE_SHORT_WORDS,
                ...(note ? {} : { [MID_WIDE_FACE]: { lineClamp: 4 } }),
                [TALL_FACE]: { lineClamp: "none" },
                [SHORT_WIDE_FACE]: { lineClamp: note || hasEdits ? 1 : 2 },
                [SHORT_SMALL_FACE]: {
                  lineClamp: hasEdits || shortMessage ? 1 : 2,
                  ...(shortMessage ? SHORT_WORDS_ONLY_HERE : {}),
                },
              }}
            >
              <Words full={message} short={shortMessage} />
            </Text>
          )}
          {note && (
            <Text
              textStyle="caption"
              color="fg.muted"
              maxWidth="380px"
              lineClamp={2}
              flexShrink={0}
              title={note}
              css={{
                ...HIDE_SHORT_WORDS,
                [NARROW_FACE]: { lineClamp: 3 },
                [SHORT_WIDE_FACE]: { lineClamp: 1 },
                [SHORT_SMALL_FACE]: shortNote
                  ? { lineClamp: 1, ...SHORT_WORDS_ONLY_HERE }
                  : { display: "none" },
              }}
            >
              <Words full={note} short={shortNote} />
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
        css={{
          [NARROW_FACE]: { marginTop: 0, ...tightIcons },
          [SHORT_FACE]: { marginTop: 0, gap: 1, ...tightIcons },
        }}
      >
        {onEditWithLangy && (
          <Button size="xs" variant="outline" disabled={editsDisabled} onClick={onEditWithLangy}>
            <Sparkles size={13} aria-hidden />
            Edit with Langy
          </Button>
        )}
        {onEditCode && (
          <Button size="xs" variant="outline" disabled={editsDisabled} onClick={onEditCode}>
            <Code2 size={13} aria-hidden />
            Edit code
          </Button>
        )}
        <Button size="xs" variant={hasEdits ? "ghost" : "outline"} onClick={onRetry}>
          <RotateCcw size={13} aria-hidden />
          Retry
        </Button>
      </HStack>
    </VStack>
  );
}
