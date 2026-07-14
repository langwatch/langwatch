import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../utils/formatters";
import { findCacheRebuilds } from "../sessionView/tokenTimeline";
import { toolResultBodyToString } from "../transcript";
import {
  CLAUDE_MARK_GRADIENT,
  TERMINAL_FONT_STACK,
  TERMINAL_TOKENS,
} from "./palette";
import { SyntaxHighlightedCode } from "./SyntaxHighlightedCode";
import type { SessionBanner } from "./sessionBanner";
import { TerminalDiff } from "./TerminalDiff";
import { TerminalOutput } from "./TerminalOutput";
import { TerminalPatch } from "./TerminalPatch";
import {
  buildEntryTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  toolPrimaryArg,
} from "./terminalSession";
import { parsePatchHunks, type TerminalToolSpan } from "./toolSpans";

/** What actually ran, keyed by the tool span's OWN id (matches `entry.spanId`). */
export type ToolSpanIndex = ReadonlyMap<string, TerminalToolSpan>;
const NO_TOOL_SPANS: ToolSpanIndex = new Map();

/**
 * The glyphs Claude Code actually draws with. Kept together because they ARE
 * the visual language — the CLI has no window chrome, no panels and no icons;
 * a bullet, a result elbow and a prompt caret carry the whole hierarchy.
 */
const GLYPH = {
  /** Opens a tool call and an assistant message. */
  bullet: "⏺",
  /** The result elbow, indented under the call it belongs to. */
  elbow: "⎿",
  /** The user's prompt caret. */
  caret: "❯",
  /** A tool the human turned down. */
  denied: "✕",
  /** Session-level notes (compaction, an error, a rate limit). */
  note: "※",
} as const;

/** Everything on the screen is one monospace size — a terminal has one font. */
const CELL = {
  fontFamily: TERMINAL_FONT_STACK,
  fontSize: "13px",
  lineHeight: "1.55",
} as const;

/**
 * The block mark Claude Code prints above the prompt when a session starts,
 * reproduced glyph-for-glyph. Three rows; the gradient is applied per
 * character so it reads as shaded rather than flat.
 */
const MARK_ROWS = [" ▐▛███▜▌", "▝▜█████▛▘", "  ▘▘ ▝▝ "] as const;

/** How close to the true bottom counts as "at the bottom", in pixels. */
const NEAR_BOTTOM_PX = 32;

/**
 * Context-size bands for the "heatmap" note — a growing context costs more
 * per call (nothing is free once it's past the cache), so crossing into a
 * bigger band is worth a line, but every single model call is not. Ratio
 * matches `TokenTimelineChart`'s own bands so the two views agree on what
 * counts as "big".
 */
const CONTEXT_HEAT_BANDS = [
  { minTokens: 150_000, color: TERMINAL_TOKENS.red, label: "large" },
  { minTokens: 50_000, color: TERMINAL_TOKENS.yellow, label: "growing" },
] as const;

function contextHeatBand(
  contextTokens: number,
): (typeof CONTEXT_HEAT_BANDS)[number] | null {
  return (
    CONTEXT_HEAT_BANDS.find((band) => contextTokens >= band.minTokens) ?? null
  );
}

/** A note inserted into the transcript at a model call, not a beat of its own. */
type ContextMarker =
  | {
      kind: "heat";
      atMs: number;
      contextTokens: number;
      color: string;
      label: string;
    }
  | {
      kind: "deadSite";
      atMs: number;
      cacheCreationTokens: number;
      previousContextTokens: number;
    };

/**
 * Where the context grew into a new size band, and where a cache rebuild
 * ("dead site" — the session paid to re-send context it already had cached)
 * happened. Keyed by the fullIndex of the NEXT visible entry after the model
 * call that triggered it, since `model_call` entries themselves render
 * nothing — see {@link TerminalView}'s `visibleIndices`.
 *
 * Band crossings only (not every call) so a long session gets a small
 * handful of "context is getting big" notes rather than one after every
 * single turn. Dead sites always show — `findCacheRebuilds` is already
 * gated to genuine rebuilds (≥1000 tokens, ≥50% of the prior context), so
 * it doesn't need the same restraint.
 */
function buildContextMarkers(
  entries: TranscriptEntry[],
  visibleIndices: readonly number[],
): Map<number, ContextMarker[]> {
  const visibleSet = new Set(visibleIndices);
  const rebuildsByAtMs = new Map(
    findCacheRebuilds(entries).map((rebuild) => [rebuild.atMs, rebuild]),
  );

  const markers = new Map<number, ContextMarker[]>();
  let pending: ContextMarker[] = [];
  let lastBandLabel: string | null = null;

  entries.forEach((entry, fullIndex) => {
    if (entry.kind === "model_call") {
      const rebuild = rebuildsByAtMs.get(entry.atMs);
      if (rebuild) {
        pending.push({
          kind: "deadSite",
          atMs: entry.atMs,
          cacheCreationTokens: rebuild.cacheCreationTokens,
          previousContextTokens: rebuild.previousContextTokens,
        });
      }

      const contextTokens = entry.cacheReadTokens + entry.cacheCreationTokens;
      const band = contextHeatBand(contextTokens);
      if (band && band.label !== lastBandLabel) {
        pending.push({
          kind: "heat",
          atMs: entry.atMs,
          contextTokens,
          color: band.color,
          label: band.label,
        });
      }
      lastBandLabel = band?.label ?? lastBandLabel;
      return;
    }

    if (pending.length > 0 && visibleSet.has(fullIndex)) {
      markers.set(fullIndex, pending);
      pending = [];
    }
  });

  return markers;
}

interface TerminalViewProps {
  /** The whole session, in the order it happened — spans AND logs, agent-neutral. */
  entries: TranscriptEntry[];
  /**
   * What each tool call actually did, from Claude's real tool spans, keyed by
   * span id. The transcript's own `tool` entries only carry what got recorded
   * generically; these carry the real stdout, the real patch, whether it
   * failed. Optional: without it the view falls back to the transcript entry.
   */
  toolSpans?: ToolSpanIndex;
  /** Claude Code's own version, model, and repo — shown above the first prompt. */
  banner?: SessionBanner;
  /** The trace's name, shown in the bottom bar where Claude Code shows its input. */
  sessionName?: string | null;
}

/**
 * A recreation of how a Claude Code session looked in the terminal — the
 * WHOLE session, not the last turn. Deliberately NOT a "terminal widget": no
 * window frame, no traffic lights, no title bar. Claude Code doesn't draw
 * those — it prints into the terminal you already have, and its entire
 * hierarchy is carried by a handful of glyphs (see {@link GLYPH}) at one
 * monospace size. Adding chrome around it makes it read as a screenshot of a
 * terminal rather than as the session itself.
 *
 * There is no drag-to-scrub control — a real terminal doesn't have one. The
 * whole session is always on screen; scrolling through it IS the time
 * travel, and the bottom bar's running totals track whatever beat is
 * currently at the bottom of the viewport. New output pulls the screen down
 * with it only while already caught up at the bottom, exactly like `tail -f`
 * — scroll up to read history and it stays put, with a "Jump to bottom"
 * affordance to snap back.
 */
export const TerminalView = memo(function TerminalView({
  entries,
  toolSpans = NO_TOOL_SPANS,
  banner,
  sessionName,
}: TerminalViewProps) {
  const timeline = useMemo(() => buildEntryTimeline(entries), [entries]);

  // `model_call` entries carry economics for the HUD but render nothing.
  const visibleIndices = useMemo(
    () =>
      entries.reduce<number[]>((acc, entry, index) => {
        if (entry.kind !== "model_call") acc.push(index);
        return acc;
      }, []),
    [entries],
  );
  const lastVisibleFullIndex = visibleIndices[visibleIndices.length - 1] ?? -1;
  const contextMarkers = useMemo(
    () => buildContextMarkers(entries, visibleIndices),
    [entries, visibleIndices],
  );

  const screenRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const setRowRef = useCallback(
    (fullIndex: number, node: HTMLDivElement | null) => {
      if (node) rowRefs.current.set(fullIndex, node);
      else rowRefs.current.delete(fullIndex);
    },
    [],
  );

  const [atBottom, setAtBottom] = useState(true);
  const [trackedFullIndex, setTrackedFullIndex] =
    useState(lastVisibleFullIndex);

  // Re-derive which beat is "at the bottom of the viewport" from the DOM —
  // rows are laid out in order, so the last one whose top hasn't scrolled
  // past the viewport's bottom edge is the one currently in view there.
  const syncToScroll = useCallback(() => {
    const el = screenRef.current;
    if (!el) return;
    const viewportBottom = el.scrollTop + el.clientHeight;
    setAtBottom(el.scrollHeight - viewportBottom <= NEAR_BOTTOM_PX);

    let best = visibleIndices[0] ?? -1;
    for (const fullIndex of visibleIndices) {
      const node = rowRefs.current.get(fullIndex);
      if (!node || node.offsetTop > viewportBottom) break;
      best = fullIndex;
    }
    setTrackedFullIndex(best);
  }, [visibleIndices]);

  // New output arrives while the reader is caught up at the bottom: follow
  // it down, the way a real terminal does. Scrolled up reading history: stay
  // put — the point of the affordance below is that this is a choice, not
  // something the screen fights you on.
  const prevEntryCountRef = useRef(entries.length);
  useEffect(() => {
    const grew = entries.length > prevEntryCountRef.current;
    prevEntryCountRef.current = entries.length;
    const el = screenRef.current;
    if (!el) return;
    if (grew && atBottom) {
      el.scrollTop = el.scrollHeight;
    }
    syncToScroll();
    // Only re-run when the entry count changes — `syncToScroll`/`atBottom`
    // would otherwise re-fire this on every scroll frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  const jumpToBottom = useCallback(() => {
    const el = screenRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setTrackedFullIndex(lastVisibleFullIndex);
  }, [lastVisibleFullIndex]);

  const point = timeline[trackedFullIndex];
  const modelAtScroll = useMemo(
    () => modelAt(entries, trackedFullIndex) ?? banner?.model ?? null,
    [entries, trackedFullIndex, banner?.model],
  );
  const trackedStep = Math.max(0, visibleIndices.indexOf(trackedFullIndex)) + 1;

  if (entries.length === 0) {
    return (
      <VStack
        align="center"
        justify="center"
        height="full"
        bg={TERMINAL_TOKENS.screenBg}
      >
        <Text {...CELL} color={TERMINAL_TOKENS.faint}>
          No terminal session recorded for this trace
        </Text>
      </VStack>
    );
  }

  return (
    <VStack
      align="stretch"
      gap={0}
      height="full"
      minHeight={0}
      position="relative"
    >
      <Box
        ref={screenRef}
        flex={1}
        minHeight={0}
        overflow="auto"
        bg={TERMINAL_TOKENS.screenBg}
        color={TERMINAL_TOKENS.screenFg}
        paddingX={3}
        paddingY={2}
        onScroll={syncToScroll}
      >
        <VStack align="stretch" gap={2.5}>
          <TerminalBanner banner={banner} />
          {visibleIndices.map((fullIndex) => (
            <Fragment key={fullIndex}>
              {contextMarkers.get(fullIndex)?.map((marker, i) => (
                <ContextMarkerLine
                  key={`${fullIndex}-marker-${i}`}
                  marker={marker}
                />
              ))}
              <Box
                ref={(node: HTMLDivElement | null) =>
                  setRowRef(fullIndex, node)
                }
              >
                <EntryLine entry={entries[fullIndex]!} toolSpans={toolSpans} />
              </Box>
            </Fragment>
          ))}
        </VStack>
      </Box>

      {!atBottom && <JumpToBottomPill onClick={jumpToBottom} />}

      <StatusLine
        stepCount={visibleIndices.length}
        currentStep={trackedStep}
        tokens={point?.cumulativeTokens ?? 0}
        costUsd={point?.cumulativeCostUsd ?? 0}
        elapsedMs={point?.elapsedMs ?? 0}
        model={modelAtScroll}
        sessionName={sessionName}
      />
    </VStack>
  );
});

/** The nearest model in effect at or before `fullIndex` — sessions mostly use one. */
function modelAt(entries: TranscriptEntry[], fullIndex: number): string | null {
  for (let i = fullIndex; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.kind === "model_call" && entry.model) return entry.model;
    if (entry?.kind === "assistant_message" && entry.model) return entry.model;
  }
  return null;
}

/**
 * Floating over the screen, the same affordance Claude Code shows once
 * you've scrolled away from live output — plain text on a solid block, the
 * same inverse-video idiom a terminal uses to highlight a line, not a
 * rounded button with a drop shadow.
 */
function JumpToBottomPill({ onClick }: { onClick: () => void }) {
  return (
    <Box
      position="absolute"
      bottom="44px"
      left="50%"
      transform="translateX(-50%)"
      zIndex={1}
    >
      <Text
        as="button"
        onClick={onClick}
        {...CELL}
        color={TERMINAL_TOKENS.faint}
        bg={TERMINAL_TOKENS.frameBg}
        paddingX={2}
        cursor="pointer"
        _hover={{ color: TERMINAL_TOKENS.screenFg }}
      >
        Jump to bottom (click) ↓
      </Text>
    </Box>
  );
}

function TerminalBanner({ banner }: { banner?: SessionBanner }) {
  if (!banner || (!banner.version && !banner.model && !banner.repo)) {
    return null;
  }
  return (
    <HStack align="center" gap={3} paddingBottom={2}>
      <ClaudeMark />
      <VStack align="stretch" gap={0} minWidth={0}>
        <Text {...CELL} color={TERMINAL_TOKENS.screenFg} fontWeight="semibold">
          {banner.version ? `Claude Code v${banner.version}` : "Claude Code"}
        </Text>
        {banner.model && (
          <Text {...CELL} color={TERMINAL_TOKENS.faint} truncate>
            {abbreviateModel(banner.model)}
          </Text>
        )}
        {banner.repo && (
          <Text {...CELL} color={TERMINAL_TOKENS.faint} truncate>
            {banner.repo}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/** The startup mark, shaded left-to-right rather than drawn in one flat colour. */
function ClaudeMark() {
  return (
    <VStack
      align="flex-start"
      gap={0}
      flexShrink={0}
      aria-hidden
      userSelect="none"
    >
      {MARK_ROWS.map((row, rowIndex) => (
        <Text key={rowIndex} {...CELL} lineHeight="1.15" whiteSpace="pre">
          {[...row].map((char, charIndex) => (
            <Fragment key={charIndex}>
              <Text as="span" color={gradientColorAt(charIndex, row.length)}>
                {char}
              </Text>
            </Fragment>
          ))}
        </Text>
      ))}
    </VStack>
  );
}

function gradientColorAt(index: number, length: number): string {
  const stops = CLAUDE_MARK_GRADIENT;
  const t = length <= 1 ? 0 : index / (length - 1);
  const stopIndex = Math.round(t * (stops.length - 1));
  return stops[stopIndex] ?? stops[stops.length - 1]!;
}

function EntryLine({
  entry,
  toolSpans,
}: {
  entry: TranscriptEntry;
  toolSpans: ToolSpanIndex;
}) {
  switch (entry.kind) {
    case "user_prompt":
      return <PromptLine text={entry.text} />;
    case "assistant_message":
      return <AssistantLine text={entry.text} />;
    case "tool":
      return (
        <ToolCall entry={entry} ran={toolSpans.get(entry.spanId) ?? null} />
      );
    case "tool_rejected":
      return <RejectedLine name={entry.name} reason={entry.reason} />;
    case "note":
      return <NoteLine level={entry.level} text={entry.text} />;
    default:
      return null;
  }
}

/** The user's prompt: `❯ what they typed`. Sets itself apart with the caret's colour, the same way the CLI does — not a background panel. */
function PromptLine({ text }: { text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph char={GLYPH.caret} color={TERMINAL_TOKENS.blue} bold />
      <Text
        {...CELL}
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        color={TERMINAL_TOKENS.screenFg}
        fontWeight="medium"
        flex={1}
        minWidth={0}
      >
        {text}
      </Text>
    </HStack>
  );
}

/**
 * The assistant's own prose. A model call that only issued tool calls has no
 * text at all — rendering nothing here (rather than an empty bullet) is
 * exactly what fixes a session collapsing to "step 1/1": its tool calls are
 * independent entries and still render as their own lines.
 */
function AssistantLine({ text }: { text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph char={GLYPH.bullet} color={TERMINAL_TOKENS.accent} />
      <Text
        {...CELL}
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        color={TERMINAL_TOKENS.screenFg}
        flex={1}
        minWidth={0}
      >
        {text}
      </Text>
    </HStack>
  );
}

/**
 * `⏺ Tool(arg)` with its result hanging underneath on the `⎿` elbow. The
 * bullet is the only status signal — muted ran, red failed — matching how
 * little chrome the real CLI draws around a tool call.
 */
function ToolCall({
  entry,
  ran,
}: {
  entry: Extract<TranscriptEntry, { kind: "tool" }>;
  /** The tool's real span, when we have it. */
  ran: TerminalToolSpan | null;
}) {
  const arg = ran?.bashCommand ?? ran?.filePath ?? toolPrimaryArg(entry.input);
  const isError = ran?.isError ?? entry.failed;
  const name = ran?.toolName ?? entry.name;

  // Edit emits a real structured patch on its span. Only fall back to diffing
  // the tool's own `old_string` → `new_string` when that patch isn't there.
  const patch = parsePatchHunks(ran?.diff ?? null);
  const synthesizedDiff =
    patch === null && isDiffTool(name)
      ? extractDiffFromToolInput(entry.input)
      : null;

  // Bash stdout / a file's content, as it actually came back — not the capped
  // echo the model was handed. Falls back to the transcript's own output.
  const ranOutput = ran?.output ?? ran?.content ?? null;
  const transcriptOutput =
    ranOutput === null && entry.output !== null
      ? toolResultBodyToString(entry.output)
      : null;

  return (
    <VStack align="stretch" gap={0.5}>
      <HStack align="flex-start" gap={2}>
        <Glyph
          char={GLYPH.bullet}
          color={isError ? TERMINAL_TOKENS.red : TERMINAL_TOKENS.faint}
        />
        {/* One flowing block, not nested spans with their own box — nesting
            `fontWeight="bold"` on an inline child was giving a wrapped
            second line extra indent from its own inline-block layout. */}
        <Text
          {...CELL}
          color={TERMINAL_TOKENS.screenFg}
          flex={1}
          minWidth={0}
          wordBreak="break-word"
        >
          <Text as="span" fontWeight="bold" color={TERMINAL_TOKENS.screenFg}>
            {name}
          </Text>
          {arg ? `(${truncateArg(arg)})` : ""}
          {entry.agentId !== null && " · sub-agent"}
        </Text>
        {ran !== null && ran.durationMs > 0 && (
          <Text {...CELL} color={TERMINAL_TOKENS.faint} flexShrink={0}>
            {formatDuration(ran.durationMs)}
          </Text>
        )}
      </HStack>

      <ResultLine>
        {patch ? (
          <TerminalPatch hunks={patch} filePath={ran?.filePath ?? undefined} />
        ) : synthesizedDiff ? (
          <TerminalDiff
            oldText={synthesizedDiff.oldText}
            newText={synthesizedDiff.newText}
            filePath={synthesizedDiff.filePath}
          />
        ) : // A real file with a real extension gets a real editor's syntax
        // highlighting — Bash stdout isn't code in any one language, so
        // only Read/Write's own `content` field (never `output`) qualifies.
        ran?.content && ran.filePath ? (
          <SyntaxHighlightedCode code={ran.content} filePath={ran.filePath} />
        ) : ranOutput !== null ? (
          <TerminalOutput text={ranOutput} isError={isError} />
        ) : transcriptOutput !== null && transcriptOutput.trim() !== "" ? (
          <TerminalOutput text={transcriptOutput} isError={isError} />
        ) : (
          <Text {...CELL} color={TERMINAL_TOKENS.faint}>
            (no output)
          </Text>
        )}
      </ResultLine>
    </VStack>
  );
}

/**
 * A tool the human turned down. It never ran, so there is no span and no
 * output — only that it was asked for and refused.
 */
function RejectedLine({
  name,
  reason,
}: {
  name: string | null;
  reason: string | null;
}) {
  const verb = reason === "user_abort" ? "aborted" : "denied";
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph char={GLYPH.denied} color={TERMINAL_TOKENS.red} />
      <Text {...CELL} color={TERMINAL_TOKENS.red} flex={1} minWidth={0}>
        {`${name ?? "A tool call"} — ${verb} by the user, never ran`}
      </Text>
    </HStack>
  );
}

/**
 * A session-level fact with no span of its own — an API error, a refusal, a
 * mid-session context compaction. These live only in the logs, so without them
 * the session reads as if they never happened.
 */
function NoteLine({
  level,
  text,
}: {
  level: "info" | "warning" | "error";
  text: string;
}) {
  const color =
    level === "error"
      ? TERMINAL_TOKENS.red
      : level === "warning"
        ? TERMINAL_TOKENS.yellow
        : TERMINAL_TOKENS.faint;
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph
        char={level === "error" ? GLYPH.bullet : GLYPH.note}
        color={color}
      />
      <Text
        {...CELL}
        color={color}
        flex={1}
        minWidth={0}
        wordBreak="break-word"
      >
        {text}
      </Text>
    </HStack>
  );
}

/**
 * A note for a context-size band crossing ("heat") or a cache rebuild ("dead
 * site" — the session paid to re-send context it already had cached). Same
 * glyph-plus-text shape as {@link NoteLine}; text only, no background tint —
 * the colour carries the signal, not a panel behind it.
 */
function ContextMarkerLine({ marker }: { marker: ContextMarker }) {
  const [color, text] =
    marker.kind === "deadSite"
      ? [
          TERMINAL_TOKENS.red,
          `Cache rebuilt: ${formatTokens(marker.cacheCreationTokens)} tok re-sent instead of reusing ${formatTokens(marker.previousContextTokens)} tok cached`,
        ]
      : [
          marker.color,
          `Context ${marker.label}: ${formatTokens(marker.contextTokens)} tok`,
        ];
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph char={GLYPH.note} color={color} />
      <Text
        {...CELL}
        color={color}
        flex={1}
        minWidth={0}
        wordBreak="break-word"
      >
        {text}
      </Text>
    </HStack>
  );
}

/**
 * The `⎿` elbow row: a result, indented under the call it belongs to. The
 * indent is two literal space characters, not `paddingLeft` — the same
 * gutter convention as {@link Glyph}, so it reads as real leading whitespace
 * rather than a CSS nudge.
 */
function ResultLine({ children }: { children: React.ReactNode }) {
  return (
    <HStack align="flex-start" gap={2}>
      <Text
        {...CELL}
        whiteSpace="pre"
        flexShrink={0}
        userSelect="none"
        aria-hidden
      >
        {"  "}
      </Text>
      <Glyph char={GLYPH.elbow} color={TERMINAL_TOKENS.faint} />
      <Box flex={1} minWidth={0}>
        {children}
      </Box>
    </HStack>
  );
}

/**
 * A leading glyph. Fixed-width and unselectable so copying the screen yields
 * clean text rather than a column of bullets.
 */
function Glyph({
  char,
  color,
  bold,
}: {
  char: string;
  color: string;
  bold?: boolean;
}) {
  return (
    <Text
      {...CELL}
      color={color}
      fontWeight={bold ? "bold" : undefined}
      flexShrink={0}
      userSelect="none"
      aria-hidden
    >
      {char}
    </Text>
  );
}

/**
 * A box drawn with the actual Unicode box-drawing glyphs a terminal would
 * use (`╭─╮│╰─╯`), not a CSS border standing in for one. The horizontal
 * rules are a long run of `─` clipped by `overflow: hidden` rather than a
 * fixed character count, so the glyph itself — not a div — is what fills the
 * row at any container width.
 */
function AsciiBox({ children }: { children: React.ReactNode }) {
  const rule = "─".repeat(400);
  return (
    <VStack align="stretch" gap={0} color={TERMINAL_TOKENS.border}>
      <HStack gap={0} overflow="hidden">
        <Text {...CELL} flexShrink={0} aria-hidden>
          ╭
        </Text>
        <Text
          {...CELL}
          overflow="hidden"
          whiteSpace="nowrap"
          flex={1}
          aria-hidden
        >
          {rule}
        </Text>
        <Text {...CELL} flexShrink={0} aria-hidden>
          ╮
        </Text>
      </HStack>
      <HStack gap={0} align="stretch">
        <Text {...CELL} flexShrink={0} aria-hidden>
          │
        </Text>
        <Text {...CELL} whiteSpace="pre" flexShrink={0} aria-hidden>
          {" "}
        </Text>
        <Box flex={1} minWidth={0} color={TERMINAL_TOKENS.screenFg}>
          {children}
        </Box>
        <Text {...CELL} whiteSpace="pre" flexShrink={0} aria-hidden>
          {" "}
        </Text>
        <Text {...CELL} flexShrink={0} aria-hidden>
          │
        </Text>
      </HStack>
      <HStack gap={0} overflow="hidden">
        <Text {...CELL} flexShrink={0} aria-hidden>
          ╰
        </Text>
        <Text
          {...CELL}
          overflow="hidden"
          whiteSpace="nowrap"
          flex={1}
          aria-hidden
        >
          {rule}
        </Text>
        <Text {...CELL} flexShrink={0} aria-hidden>
          ╯
        </Text>
      </HStack>
    </VStack>
  );
}

/**
 * The bottom bar — Claude Code's own idiom: a box-drawn input bar (the
 * session's name standing in for what you'd type) with a thin status line
 * underneath it (`⏵⏵ …`). Reports what the session had cost by the beat
 * currently scrolled to the bottom of the viewport — no drag control,
 * scrolling IS the time travel. Fixed to the bottom of the pane, both the
 * box and the line under it — neither scrolls away with the transcript
 * above.
 */
function StatusLine({
  stepCount,
  currentStep,
  tokens,
  costUsd,
  elapsedMs,
  model,
  sessionName,
}: {
  stepCount: number;
  currentStep: number;
  tokens: number;
  costUsd: number;
  elapsedMs: number;
  model?: string | null;
  sessionName?: string | null;
}) {
  return (
    <VStack
      align="stretch"
      gap={1.5}
      paddingX={3}
      paddingY={2}
      // Same surface as the screen above, not a separate panel — the box's
      // own `╭─╮` rule is what marks the boundary, not a CSS border on top of it.
      bg={TERMINAL_TOKENS.screenBg}
      flexShrink={0}
    >
      <AsciiBox>
        <HStack gap={2}>
          <Text
            {...CELL}
            color={TERMINAL_TOKENS.blue}
            fontWeight="bold"
            flexShrink={0}
            aria-hidden
          >
            ❯
          </Text>
          <Text
            {...CELL}
            color={TERMINAL_TOKENS.faint}
            truncate
            minWidth={0}
            flex={1}
          >
            {sessionName ?? "Untitled session"}
          </Text>
        </HStack>
      </AsciiBox>

      <HStack gap={2} justify="space-between" flexWrap="wrap">
        <HStack gap={2} minWidth={0}>
          <Text
            {...CELL}
            color={TERMINAL_TOKENS.accent}
            flexShrink={0}
            aria-hidden
          >
            ⏵⏵
          </Text>
          <Text {...CELL} color={TERMINAL_TOKENS.faint} flexShrink={0}>
            {`step ${currentStep}/${stepCount}`}
          </Text>
        </HStack>
        <HStack gap={3} flexWrap="wrap" justify="flex-end">
          {model && <Stat label={abbreviateModel(model)} />}
          {elapsedMs > 0 && <Stat label={formatDuration(elapsedMs)} />}
          {tokens > 0 && <Stat label={`${formatTokens(tokens)} tok`} />}
          {costUsd > 0 && <Stat label={formatCost(costUsd)} accent />}
        </HStack>
      </HStack>
    </VStack>
  );
}

function Stat({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <Text
      {...CELL}
      color={accent ? TERMINAL_TOKENS.accent : TERMINAL_TOKENS.faint}
      fontWeight={accent ? "semibold" : undefined}
    >
      {label}
    </Text>
  );
}

function truncateArg(arg: string): string {
  const oneLine = arg.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}
