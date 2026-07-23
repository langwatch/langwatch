import { chakra, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Bot,
  Film,
  Paperclip,
  User,
  Wrench,
} from "lucide-react";
import type React from "react";
import {
  Fragment,
  memo,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { TraceMediaRef } from "~/shared/traces/media-refs";
import type { MediaPartData } from "~/shared/traces/mediaParts";
import { collectMediaParts } from "~/shared/traces/mediaParts";
import { useDensityTokens } from "../../hooks/useDensityTokens";
import { useDensityStore } from "../../stores/densityStore";
import { formatPreview } from "../../utils/previewFormatter";
import { tryParseChat } from "./chatContent";

const COMFORTABLE_LABEL_WIDTH = "60px";

interface IOPreviewProps {
  input: string | null;
  output: string | null;
  /**
   * Media refs from the trace summary (fold-derived). When present they are
   * the source of truth for the row's thumbnail/indicators — the summary's
   * input/output are flattened text with no parts left to parse. Absent
   * (older summaries, sample data), the row text is media-hint parsed.
   */
  inputMediaRefs?: TraceMediaRef[];
  outputMediaRefs?: TraceMediaRef[];
}

// memo: the addon cell re-renders with identical props whenever the table
// re-renders (density is read via the store INSIDE, so density flips still
// propagate); the preview parse work is additionally cached per row below.
export const IOPreview = memo(function IOPreview({
  input,
  output,
  inputMediaRefs,
  outputMediaRefs,
}: IOPreviewProps) {
  const density = useDensityStore((s) => s.density);
  if (density === "comfortable") {
    return (
      <ComfortableIOPreview
        input={input}
        output={output}
        inputMediaRefs={inputMediaRefs}
        outputMediaRefs={outputMediaRefs}
      />
    );
  }
  return (
    <CompactIOPreview
      input={input}
      output={output}
      inputMediaRefs={inputMediaRefs}
      outputMediaRefs={outputMediaRefs}
    />
  );
});

/**
 * Build the row data once per cell. `formatPreview` runs the unified
 * unwrap/strip/glyph pipeline; `tryParseChat` is still consulted for the
 * isChat/isTool flags that drive the role icon. Both are cheap (each does
 * one JSON.parse attempt on the same input).
 */
/**
 * Non-selectable hard-newline marker, rendered at the END of the line
 * that was broken — same affordance as a GitHub diff's `+`/`-` gutter:
 * visible, but never part of what you select and copy.
 *
 * Two properties make that work:
 *  - The glyph lives in a `::after` pseudo-element. Pseudo content is
 *    never part of the DOM text, so it can't be selected or copied in
 *    any browser (more robust than `user-select: none` alone, which
 *    Firefox still copies). `user-select: none` is kept as a belt to
 *    the pseudo's suspenders.
 *  - The span itself is zero-width with `overflow: visible`, so the
 *    glyph hangs past the last character without consuming layout
 *    width. It therefore can't push the line wider and can't wrap onto
 *    a line of its own.
 */
const BreakMarker = () => (
  <chakra.span
    data-newline-marker=""
    aria-hidden="true"
    userSelect="none"
    display="inline-block"
    width="0"
    overflow="visible"
    whiteSpace="nowrap"
    verticalAlign="baseline"
    color="fg.subtle"
    css={{ "&::after": { content: '"↵"', marginInlineStart: "0.45em" } }}
  />
);

const CLAMP_LINES = 2;

/**
 * CSS rule that blanks a `BreakMarker` glyph once it's been tagged
 * `data-newline-marker-hidden` by `useBreakMarkerClampGuard`. Hiding via
 * the pseudo's `content` (rather than `display`/`visibility`) keeps the
 * span's box on its line, so measuring it on the next resize pass stays
 * stable.
 */
const HIDE_TRUNCATED_MARKER = {
  "& [data-newline-marker][data-newline-marker-hidden]::after": {
    content: '""',
  },
} as const;

/**
 * A `BreakMarker` only collides with the line clamp's `…` ellipsis when the
 * cell overflows AND the marker sits on the last visible (clamped) line —
 * that's the single line the clamp paints the ellipsis on. Markers on
 * earlier, fully-visible lines are safe and keep showing. `markerTop` and
 * `clampHeight` are measured relative to the clamped text box.
 */
export function shouldHideBreakMarker({
  truncated,
  markerTop,
  clampHeight,
}: {
  truncated: boolean;
  markerTop: number;
  clampHeight: number;
}): boolean {
  if (!truncated) return false;
  const lastVisibleLineTop = (clampHeight * (CLAMP_LINES - 1)) / CLAMP_LINES;
  return markerTop >= lastVisibleLineTop - 1;
}

/**
 * Tags the break markers that would overlap the clamp's `…` with
 * `data-newline-marker-hidden` (see `shouldHideBreakMarker`). Re-evaluates
 * on resize so it tracks column-width changes, not just the first paint.
 * The text node is `position: relative` so each marker's `offsetTop` is
 * measured against the clamped box.
 */
function useBreakMarkerClampGuard(text: string) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const truncated = el.scrollHeight > el.clientHeight + 1;
      const clampHeight = el.clientHeight;
      el.querySelectorAll<HTMLElement>("[data-newline-marker]").forEach((m) => {
        m.toggleAttribute(
          "data-newline-marker-hidden",
          shouldHideBreakMarker({
            truncated,
            markerTop: m.offsetTop,
            clampHeight,
          }),
        );
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return ref;
}

/**
 * Line-clamped preview text that renders hard breaks as non-selectable `↵`
 * markers and suppresses only the marker on the truncated line (see
 * `useBreakMarkerClampGuard`). Style props (`fontSize`, `color`,
 * `textStyle`, …) are forwarded so both density rows can share it.
 */
const ClampedPreviewText: React.FC<
  { text: string } & React.ComponentProps<typeof Text>
> = ({ text, css, ...rest }) => {
  const ref = useBreakMarkerClampGuard(text);
  return (
    <Text
      ref={ref}
      position="relative"
      whiteSpace="pre-line"
      lineClamp={CLAMP_LINES}
      width="full"
      minWidth={0}
      css={{ ...HIDE_TRUNCATED_MARKER, ...(css as object) }}
      {...rest}
    >
      {renderWithBreakMarkers(text)}
    </Text>
  );
};

/**
 * Render preview text with a hard break shown as a trailing `BreakMarker`
 * on each broken line, followed by a real `\n` (the parent `Text` uses
 * `whiteSpace="pre-line"`, so the `\n` produces the actual visual wrap).
 * The text nodes stay clean — only the line content lands in the DOM, so
 * a copy of the selection round-trips to the original two-line string.
 */
function renderWithBreakMarkers(text: string): ReactNode {
  // Strip trailing whitespace so we never end on a break, normalize CRLF/CR so
  // a stray `\r` can't cling to a line, then collapse runs of blank lines to a
  // single break. A compact two-line preview shows content, not blank gaps,
  // and its text is already a processed preview (markdown-unwrapped and
  // truncated), not the verbatim source — so blank-line fidelity isn't a goal.
  const normalized = text.replace(/\s+$/u, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split(/\n+/);
  if (lines.length <= 1) return normalized;
  return lines.map((line, i) => (
    <Fragment key={i}>
      {line}
      {i < lines.length - 1 && (
        <>
          <BreakMarker />
          {"\n"}
        </>
      )}
    </Fragment>
  ));
}

/**
 * Compact media summary for a preview row: the first image becomes a small
 * thumbnail below the preview text (same text-then-media order as the
 * drawer), everything else collapses into per-kind indicator icons inline
 * before the text. The collection is media-hint gated, so text-only rows
 * never pay a JSON parse.
 */
interface RowMedia {
  imageSrc: string | null;
  hasAudio: boolean;
  hasVideo: boolean;
  hasAttachment: boolean;
}

const NO_ROW_MEDIA: RowMedia = {
  imageSrc: null,
  hasAudio: false,
  hasVideo: false,
  hasAttachment: false,
};

function mediaSrc(media: Extract<MediaPartData, { source: unknown }>): string {
  return media.source.type === "url"
    ? media.source.value
    : `data:${media.source.mimeType};base64,${media.source.value}`;
}

/** Summary-provided refs → the row media summary (preferred source). */
export function rowMediaFromRefs(
  refs: TraceMediaRef[] | undefined,
): RowMedia | null {
  if (!refs || refs.length === 0) return null;
  const summary: RowMedia = { ...NO_ROW_MEDIA };
  for (const ref of refs) {
    if (ref.kind === "image") summary.imageSrc ??= ref.url;
    else if (ref.kind === "audio") summary.hasAudio = true;
    else if (ref.kind === "video") summary.hasVideo = true;
    else summary.hasAttachment = true;
  }
  return summary;
}

export function collectRowMedia(raw: string | null): RowMedia {
  if (raw === null) return NO_ROW_MEDIA;
  const parts = collectMediaParts(raw);
  if (parts.length === 0) return NO_ROW_MEDIA;
  const summary: RowMedia = { ...NO_ROW_MEDIA };
  for (const part of parts) {
    if (part.type === "binary") {
      const mime = part.mimeType.toLowerCase();
      if (mime.startsWith("audio/")) summary.hasAudio = true;
      else if (mime.startsWith("video/")) summary.hasVideo = true;
      else if (mime.startsWith("image/")) {
        summary.imageSrc ??=
          part.url ??
          (part.data ? `data:${part.mimeType};base64,${part.data}` : null);
      } else summary.hasAttachment = true;
    } else if (part.type === "image") {
      summary.imageSrc ??= mediaSrc(part);
    } else if (part.type === "audio") {
      summary.hasAudio = true;
    } else {
      summary.hasVideo = true;
    }
  }
  return summary;
}

/**
 * Per-kind indicator icons rendered inline at the start of a preview row.
 * Renders nothing when the row has no audio/video/attachment media (the
 * image thumbnail is rendered separately, below the text).
 */
const RowMediaIndicators: React.FC<{ media: RowMedia }> = ({ media }) => {
  if (!media.hasAudio && !media.hasVideo && !media.hasAttachment) {
    return null;
  }
  return (
    <Flex align="center" gap={1} flexShrink={0}>
      {media.hasAudio && (
        <Icon boxSize="12px" color="fg.muted" data-testid="io-preview-audio">
          <AudioLines />
        </Icon>
      )}
      {media.hasVideo && (
        <Icon boxSize="12px" color="fg.muted" data-testid="io-preview-video">
          <Film />
        </Icon>
      )}
      {media.hasAttachment && (
        <Icon
          boxSize="12px"
          color="fg.muted"
          data-testid="io-preview-attachment"
        >
          <Paperclip />
        </Icon>
      )}
    </Flex>
  );
};

/**
 * The row's image, rendered on its own line below the preview text — the
 * same text-then-media order the drawer uses. Height-capped with natural
 * aspect ratio; a width cap crops runaway panoramas.
 */
const RowThumbnail: React.FC<{ src: string; height: string }> = ({
  src,
  height,
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    data-testid="io-preview-thumbnail"
    src={src}
    alt=""
    loading="lazy"
    style={{
      height,
      width: "auto",
      maxWidth: "160px",
      objectFit: "cover",
      borderRadius: "4px",
      display: "block",
    }}
  />
);

function buildRow(
  raw: string | null,
  refs?: TraceMediaRef[],
): {
  text: string;
  isChat: boolean;
  isTool: boolean;
  media: RowMedia;
} {
  if (raw === null && (!refs || refs.length === 0))
    return { text: "", isChat: false, isTool: false, media: NO_ROW_MEDIA };
  const parsed = raw === null ? null : tryParseChat(raw);
  // Keep newlines as real `\n` — the row text renders them with
  // `whiteSpace="pre-line"`, and `renderWithBreakMarkers` decorates each
  // break with a non-selectable marker at render time.
  const formatted =
    raw === null
      ? { text: "" }
      : formatPreview(raw, { maxChars: 200, newlines: "preserve" });
  return {
    text: formatted.text,
    isChat: parsed?.isChat ?? false,
    isTool: parsed?.isTool ?? false,
    media: rowMediaFromRefs(refs) ?? collectRowMedia(raw),
  };
}

const CompactIOPreview: React.FC<IOPreviewProps> = ({
  input,
  output,
  inputMediaRefs,
  outputMediaRefs,
}) => {
  const tokens = useDensityTokens();
  // Cache the parse work per row: without this a density flip (a store
  // subscription every visible cell holds) re-parses every row's IO.
  const inputRow = useMemo(
    () => (input !== null ? buildRow(input, inputMediaRefs) : null),
    [input, inputMediaRefs],
  );
  const outputRow = useMemo(
    () => (output !== null ? buildRow(output, outputMediaRefs) : null),
    [output, outputMediaRefs],
  );
  return (
    <VStack align="start" gap={0.5} fontFamily="mono">
      {inputRow && (
        <CompactRow
          row={inputRow}
          fontSize={tokens.ioFontSize}
          direction="input"
        />
      )}
      {outputRow && (
        <CompactRow
          row={outputRow}
          fontSize={tokens.ioFontSize}
          direction="output"
        />
      )}
    </VStack>
  );
};

interface CompactRowProps {
  row: { text: string; isChat: boolean; isTool: boolean; media: RowMedia };
  fontSize: string;
  direction: "input" | "output";
}

const CompactRow: React.FC<CompactRowProps> = ({
  row,
  fontSize,
  direction,
}) => {
  const isInput = direction === "input";
  // Vivid palette in light mode — `*.solid` matches the saturated tone
  // the filter sidebar uses for the origin dots, so the table accents
  // and the sidebar legend feel like the same palette. Dark mode keeps
  // `*.fg` because against the dark canvas the solid step over-pops.
  const accent = isInput
    ? { base: "blue.500", _dark: "blue.fg" }
    : { base: "green.solid", _dark: "green.fg" };
  const textColor = isInput ? "fg.muted" : "fg.subtle";

  return (
    <HStack gap={1} width="full" overflow="hidden" align="flex-start">
      {/* Removed the dashed vertical bar that used to sit before the
          arrow icon — it read as visual noise and didn't add an
          alignment cue the row tint isn't already providing. */}
      <Flex align="center" gap={1} flexShrink={0} paddingTop="2px">
        <Icon boxSize="10px" color={accent}>
          {isInput ? <ArrowUp /> : <ArrowDown />}
        </Icon>
        <RoleIcon row={row} color={accent} direction={direction} />
        <RowMediaIndicators media={row.media} />
      </Flex>
      <VStack align="start" gap={1} flex={1} minWidth={0}>
        {/* Preserve real newlines coming through formatPreview (the row text
            used to inline-render `↵` glyphs — now wraps onto a real second
            line). Capped at 2 lines so the preview stays compact in the
            table. */}
        <ClampedPreviewText
          text={row.text}
          fontSize={fontSize}
          color={textColor}
          fontStyle="italic"
          fontWeight="400"
        />
        {row.media.imageSrc && (
          <RowThumbnail src={row.media.imageSrc} height="36px" />
        )}
      </VStack>
    </HStack>
  );
};

const RoleIcon: React.FC<{
  row: { isChat: boolean; isTool: boolean };
  color: string | { base: string; _dark: string };
  direction: "input" | "output";
}> = ({ row, color, direction }) => {
  if (direction === "input") {
    return row.isChat ? (
      <Icon boxSize="10px" color={color}>
        <User />
      </Icon>
    ) : null;
  }
  if (row.isTool) {
    return (
      <Icon boxSize="10px" color={color}>
        <Wrench />
      </Icon>
    );
  }
  if (row.isChat) {
    return (
      <Icon boxSize="10px" color={color}>
        <Bot />
      </Icon>
    );
  }
  return null;
};

const ComfortableIOPreview: React.FC<IOPreviewProps> = ({
  input,
  output,
  inputMediaRefs,
  outputMediaRefs,
}) => {
  const inputRow = useMemo(
    () =>
      input !== null
        ? {
            text: formatPreview(input, { maxChars: 200, newlines: "preserve" })
              .text,
            media: rowMediaFromRefs(inputMediaRefs) ?? collectRowMedia(input),
          }
        : null,
    [input, inputMediaRefs],
  );
  const outputRow = useMemo(
    () =>
      output !== null
        ? {
            text: formatPreview(output, { maxChars: 200, newlines: "preserve" })
              .text,
            media: rowMediaFromRefs(outputMediaRefs) ?? collectRowMedia(output),
          }
        : null,
    [output, outputMediaRefs],
  );
  return (
    <VStack align="stretch" gap={2} fontFamily="mono">
      {inputRow && (
        <ComfortableRow
          label="Input"
          labelColor={{ base: "blue.500", _dark: "blue.fg" }}
          textColor="fg.muted"
          text={inputRow.text}
          media={inputRow.media}
        />
      )}
      {outputRow && (
        <ComfortableRow
          label="Output"
          labelColor={{ base: "green.solid", _dark: "green.fg" }}
          textColor="fg"
          text={outputRow.text}
          media={outputRow.media}
        />
      )}
    </VStack>
  );
};

const ComfortableRow: React.FC<{
  label: string;
  labelColor: string | { base: string; _dark: string };
  textColor: string;
  text: string;
  media: RowMedia;
}> = ({ label, labelColor, textColor, text, media }) => (
  <HStack align="flex-start" gap={2}>
    <Text
      textStyle="sm"
      fontWeight="600"
      color={labelColor}
      flexShrink={0}
      width={COMFORTABLE_LABEL_WIDTH}
    >
      {label}
    </Text>
    <VStack align="start" gap={1.5} flex={1} minWidth={0}>
      <HStack width="full" gap={1} align="flex-start">
        <RowMediaIndicators media={media} />
        <ClampedPreviewText text={text} textStyle="sm" color={textColor} />
      </HStack>
      {media.imageSrc && <RowThumbnail src={media.imageSrc} height="48px" />}
    </VStack>
  </HStack>
);
