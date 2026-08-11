import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import {
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../utils/formatters";
import { findCacheRebuilds } from "../sessionView/tokenTimeline";
import { toolResultBodyToString } from "../transcript";
import { classifyPromptText } from "./injectedNotice";
import {
  CLAUDE_MARK_GRADIENT,
  TERMINAL_FONT_STACK,
  TERMINAL_TOKENS,
} from "./palette";
import { SyntaxHighlightedCode } from "./SyntaxHighlightedCode";
import type { SessionBanner } from "./sessionBanner";
import type { TurnDivider } from "./sessionScrollback";
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
import {
  CONVERSATION_TURN_CAP,
  type ScrollbackStatus,
} from "./useSessionScrollback";

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
 * How close to the top a reader has to be for an upward gesture to mean "read
 * further back". Generous, because the gesture is what triggers a load, not the
 * position: a wheel flick that lands here has momentum the reader expects to
 * carry them past the top.
 */
const LOAD_EARLIER_PX = 200;

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

/**
 * A turn can open on entries that render nothing (a `model_call` carries
 * economics only), and a divider drawn at an index that never reaches the
 * screen is a boundary the reader never sees. Each one moves down to the first
 * entry that does render, exactly as {@link buildContextMarkers} does with its
 * pending notes.
 */
function forwardDividersToVisible(
  turnDividers: ReadonlyMap<number, TurnDivider> | undefined,
  entries: TranscriptEntry[],
  visibleIndices: readonly number[],
): Map<number, TurnDivider> | null {
  if (!turnDividers || turnDividers.size === 0) return null;

  const visibleSet = new Set(visibleIndices);
  const forwarded = new Map<number, TurnDivider>();
  let pending: TurnDivider | null = null;

  entries.forEach((_, fullIndex) => {
    pending = turnDividers.get(fullIndex) ?? pending;
    if (pending !== null && visibleSet.has(fullIndex)) {
      forwarded.set(fullIndex, pending);
      pending = null;
    }
  });

  return forwarded;
}

/**
 * Which beat is at the bottom of the viewport, read back off the DOM. Rows are
 * laid out in order, so the last one whose top has not scrolled past the
 * bottom edge is the one in view there, and that is the beat the bottom bar's
 * running totals report.
 */
function trackedIndexAt({
  rows,
  visibleIndices,
  viewportBottom,
}: {
  rows: ReadonlyMap<number, HTMLDivElement>;
  visibleIndices: readonly number[];
  viewportBottom: number;
}): number {
  let best = visibleIndices[0] ?? -1;
  for (const fullIndex of visibleIndices) {
    const node = rows.get(fullIndex);
    if (!node || node.offsetTop > viewportBottom) break;
    best = fullIndex;
  }
  return best;
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
  /**
   * A stable identity per entry, parallel to `entries`. Without it rows are
   * keyed by position, which is only safe while nothing is ever prepended.
   */
  rowKeys?: string[];
  /** Where one turn of the session ends and the next begins, by entry index. */
  turnDividers?: ReadonlyMap<number, TurnDivider>;
  /** The rest of the session, above the turn on screen. Absent: this turn is all there is. */
  scrollback?: {
    status: ScrollbackStatus;
    earlierCount: number;
    onLoadEarlier: () => void;
  };
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
  rowKeys,
  turnDividers,
  scrollback,
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
  const dividersAtVisibleIndex = useMemo(
    () => forwardDividersToVisible(turnDividers, entries, visibleIndices),
    [turnDividers, entries, visibleIndices],
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

  const [isAtBottom, setIsAtBottom] = useState(true);
  const [trackedFullIndex, setTrackedFullIndex] =
    useState(lastVisibleFullIndex);

  // What the screen measured last, so a prepend can be told apart from a
  // resize and undone by exactly the height that arrived above the reader.
  const prevFirstEntryRef = useRef<TranscriptEntry | undefined>(entries[0]);
  const lastScrollHeightRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const prependedThisCommitRef = useRef(false);

  const scrollbackStatus = scrollback?.status;
  const onLoadEarlier = scrollback?.onLoadEarlier;
  const requestEarlierTurn = useCallback(() => {
    if (scrollbackStatus === "available") onLoadEarlier?.();
  }, [scrollbackStatus, onLoadEarlier]);

  const syncToScroll = useCallback(() => {
    const el = screenRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    const viewportBottom = scrollTop + el.clientHeight;
    setIsAtBottom(el.scrollHeight - viewportBottom <= NEAR_BOTTOM_PX);

    // The gesture, not the position, is what asks for more session. The tab
    // opens at the top of its own turn, so anything that triggered on being
    // near the top would walk the whole session back before the reader had
    // read a line.
    const movedUp = scrollTop < lastScrollTopRef.current - 1;
    lastScrollTopRef.current = scrollTop;
    lastScrollHeightRef.current = el.scrollHeight;
    if (movedUp && scrollTop <= LOAD_EARLIER_PX) requestEarlierTurn();

    setTrackedFullIndex(
      trackedIndexAt({
        rows: rowRefs.current,
        visibleIndices,
        viewportBottom,
      }),
    );
  }, [visibleIndices, requestEarlierTurn]);

  // A short turn never overflows, so it emits no scroll event to read a
  // gesture from. The wheel says the same thing the scroll would have.
  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const el = screenRef.current;
      if (!el || event.deltaY >= 0) return;
      if (el.scrollTop <= LOAD_EARLIER_PX) requestEarlierTurn();
    },
    [requestEarlierTurn],
  );

  // Earlier turns arrived ABOVE the reader: everything they were looking at
  // just moved down by the height of what was inserted, so the screen moves
  // with it and the row under their eyes stays under their eyes. Runs before
  // the follow-the-tail effect below, which must not fire on this commit.
  useLayoutEffect(() => {
    const previousFirst = prevFirstEntryRef.current;
    const nextFirst = entries[0];
    const prepended =
      previousFirst !== undefined &&
      nextFirst !== previousFirst &&
      entries.includes(previousFirst);
    prependedThisCommitRef.current = prepended;
    prevFirstEntryRef.current = nextFirst;

    const el = screenRef.current;
    if (!el) return;
    if (prepended) {
      el.scrollTop += el.scrollHeight - lastScrollHeightRef.current;
      lastScrollTopRef.current = el.scrollTop;
    }
    lastScrollHeightRef.current = el.scrollHeight;
  }, [entries]);

  // New output arrives while the reader is caught up at the bottom: follow
  // it down, the way a real terminal does. Scrolled up reading history: stay
  // put — the point of the affordance below is that this is a choice, not
  // something the screen fights you on. History arriving at the TOP is never
  // new output, however short the turn is and however close to the bottom the
  // reader happens to be sitting.
  const prevEntryCountRef = useRef(entries.length);
  useEffect(() => {
    const hasGrown = entries.length > prevEntryCountRef.current;
    prevEntryCountRef.current = entries.length;
    const el = screenRef.current;
    if (!el) return;
    if (hasGrown && isAtBottom && !prependedThisCommitRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    syncToScroll();
    // Only re-run when the entry count changes — `syncToScroll`/`isAtBottom`
    // would otherwise re-fire this on every scroll frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length]);

  const jumpToBottom = useCallback(() => {
    const el = screenRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsAtBottom(true);
    setTrackedFullIndex(lastVisibleFullIndex);
  }, [lastVisibleFullIndex]);

  const point = timeline[trackedFullIndex];
  const modelAtScroll = useMemo(
    () => modelAt(entries, trackedFullIndex) ?? banner?.model ?? null,
    [entries, trackedFullIndex, banner?.model],
  );
  // An agent that reported usage but no content has entries and no beats to
  // walk, which read as "step 1/0" while standing on nothing.
  const trackedStep =
    visibleIndices.length === 0
      ? 0
      : Math.max(0, visibleIndices.indexOf(trackedFullIndex)) + 1;

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
        data-testid="terminal-screen"
        flex={1}
        minHeight={0}
        overflow="auto"
        bg={TERMINAL_TOKENS.screenBg}
        color={TERMINAL_TOKENS.screenFg}
        paddingX={3}
        paddingY={2}
        onScroll={syncToScroll}
        onWheel={onWheel}
        // Anchoring is the browser holding a row still by moving `scrollTop`
        // itself, which would fight the prepend correction above and land the
        // reader somewhere neither of them intended.
        style={{ overflowAnchor: "none" }}
      >
        <VStack align="stretch" gap={2.5}>
          <ScrollbackTop
            banner={banner}
            scrollback={scrollback}
            loadedTurnCount={(turnDividers?.size ?? 0) + 1}
          />
          {visibleIndices.length === 0 && entries.length > 0 && (
            <Text {...CELL} color={TERMINAL_TOKENS.faint}>
              This agent reported tokens and timing only: its telemetry carries
              no conversation content to replay. The totals below are real.
            </Text>
          )}
          {visibleIndices.map((fullIndex) => {
            const divider = dividersAtVisibleIndex?.get(fullIndex);
            return (
              <Fragment key={rowKeys?.[fullIndex] ?? fullIndex}>
                {divider && <TurnDividerLine divider={divider} />}
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
                  <EntryLine
                    entry={entries[fullIndex]!}
                    toolSpans={toolSpans}
                  />
                </Box>
              </Fragment>
            );
          })}
        </VStack>
      </Box>

      {!isAtBottom && <JumpToBottomPill onClick={jumpToBottom} />}

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
        asChild
        {...CELL}
        color={TERMINAL_TOKENS.faint}
        bg={TERMINAL_TOKENS.frameBg}
        paddingX={2}
        cursor="pointer"
        _hover={{ color: TERMINAL_TOKENS.screenFg }}
      >
        {/* A real button, typed explicitly: inside a form, the default
            `type` would be submit. */}
        <button type="button" onClick={onClick}>
          Jump to bottom (click) ↓
        </button>
      </Text>
    </Box>
  );
}

/** One same-colored run of a mark row. */
interface MarkSegment {
  text: string;
  color: string;
  /**
   * Cell background fill. Backgrounds paint the full line box (block glyphs
   * only ink the glyph itself), so marks that shade their letter counters
   * need it to read as solid letterforms instead of outlines.
   */
  bg?: string;
}

interface MarkSpec {
  rows: MarkSegment[][];
  /** Overrides the terminal cell size — the codex knot needs tiny cells. */
  fontSize?: string;
}

function flatMark(rows: readonly string[], color: string): MarkSpec {
  return { rows: rows.map((row) => [{ text: row, color }]) };
}

/** Per-character-column colors — how gemini's chevron shades left to right. */
function columnColoredMark(
  rows: readonly string[],
  columnColors: readonly string[],
): MarkSpec {
  return {
    rows: rows.map((row) =>
      [...row].map((char, column) => ({
        text: char,
        color:
          columnColors[column] ?? columnColors[columnColors.length - 1] ?? "",
      })),
    ),
  };
}

function claudeGradientMark(rows: readonly string[]): MarkSpec {
  return {
    rows: rows.map((row) =>
      [...row].map((char, index) => ({
        text: char,
        color: gradientColorAt(index, row.length),
      })),
    ),
  };
}

/**
 * Gemini CLI's chevron, glyphs and colors captured from the real banner
 * (tmux capture-pane -e of `gemini` v0.51): a five-column gradient from
 * blue to pink, colored by COLUMN, not by row.
 */
const GEMINI_MARK = columnColoredMark(
  ["▝▜▄  ", "  ▝▜▄", " ▗▟▀ ", "▝▀   "],
  ["#4796E4", "#6688D9", "#847ACE", "#A471A7", "#C3677F"],
);

/**
 * opencode's block wordmark, segment-for-segment from the real TUI (tmux
 * capture-pane -e of `opencode` v1.18): "open" in gray, "code" in near-white,
 * the letter counters filled with a raised background tone, and the n's
 * under-arch gap drawn in the counter color. Without the background fills the
 * letters read as hollow outlines and the n welds shut into an o.
 */
const OPENCODE_GRAY = "#808080";
const OPENCODE_GRAY_FILL = "#282828";
const OPENCODE_WHITE = "#EEEEEE";
const OPENCODE_WHITE_FILL = "#434343";
const OPENCODE_MARK: MarkSpec = {
  rows: [
    [{ text: "                                 ▄", color: OPENCODE_WHITE }],
    [
      { text: "█▀▀█ █▀▀█ █▀▀█ █▀▀▄ ", color: OPENCODE_GRAY },
      { text: "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", color: OPENCODE_WHITE },
    ],
    [
      { text: "█", color: OPENCODE_GRAY },
      { text: "  ", color: OPENCODE_GRAY, bg: OPENCODE_GRAY_FILL },
      { text: "█ █", color: OPENCODE_GRAY },
      { text: "  ", color: OPENCODE_GRAY, bg: OPENCODE_GRAY_FILL },
      { text: "█ █", color: OPENCODE_GRAY },
      { text: "▀▀▀", color: OPENCODE_GRAY, bg: OPENCODE_GRAY_FILL },
      { text: " █", color: OPENCODE_GRAY },
      { text: "  ", color: OPENCODE_GRAY, bg: OPENCODE_GRAY_FILL },
      { text: "█ ", color: OPENCODE_GRAY },
      { text: "█", color: OPENCODE_WHITE },
      { text: "   ", color: OPENCODE_WHITE, bg: OPENCODE_WHITE_FILL },
      { text: " █", color: OPENCODE_WHITE },
      { text: "  ", color: OPENCODE_WHITE, bg: OPENCODE_WHITE_FILL },
      { text: "█ █", color: OPENCODE_WHITE },
      { text: "  ", color: OPENCODE_WHITE, bg: OPENCODE_WHITE_FILL },
      { text: "█ █", color: OPENCODE_WHITE },
      { text: "▀▀▀", color: OPENCODE_WHITE, bg: OPENCODE_WHITE_FILL },
    ],
    [
      { text: "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀", color: OPENCODE_GRAY },
      { text: "▀▀", color: OPENCODE_GRAY_FILL },
      { text: "▀ ", color: OPENCODE_GRAY },
      { text: "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀", color: OPENCODE_WHITE },
    ],
  ],
};

/** The OpenAI knot, drawn in blocks; tiny cells keep it banner-sized. */
const CODEX_MARK: MarkSpec = {
  ...flatMark(
    [
      "             ████████",
      "          ███████████████████",
      "        █████████████████████████",
      "        ██████████████████████████",
      "     ███████████████████████████████",
      "   █████████████████████████████████",
      " ████████████████████████████████████",
      "█████████   ████████████████████████",
      "██████████   ████████████████████████",
      "███████████   ████████████████████████",
      "████████████   ████████████████████████",
      " ██████████   █████████████████████████",
      "  ████████   ██████████████████████████",
      "   ██████   ███████           █████████",
      "  ████████████████████████████████████",
      "   █████████████████████████████████",
      "   ███████████████████████████████",
      "    ███████████████████████████",
      "      █████████████████████████",
      "          ███████████████████",
    ],
    TERMINAL_TOKENS.screenFg,
  ),
  fontSize: "4px",
};

/**
 * The name each agent prints for itself, and the mark drawn next to it —
 * each agent's REAL startup art, reproduced glyph-for-glyph (and, for
 * gemini and opencode, color-for-color) from a live session. An agent we
 * can't identify gets a monochrome, armless cousin of the claude creature
 * rather than wearing another agent's badge.
 */
const AGENT_BANNERS: Record<
  SessionBanner["agent"],
  { name: string; mark: MarkSpec }
> = {
  claude_code: { name: "Claude Code", mark: claudeGradientMark(MARK_ROWS) },
  claude_cowork: { name: "Claude Cowork", mark: claudeGradientMark(MARK_ROWS) },
  opencode: { name: "opencode", mark: OPENCODE_MARK },
  codex: { name: "Codex", mark: CODEX_MARK },
  gemini_cli: { name: "Gemini CLI", mark: GEMINI_MARK },
  copilot: {
    name: "GitHub Copilot",
    mark: flatMark(["▗▛▀▀▀▜▖", "▐ ▐▌▐▌▌", "▝▙▄▄▄▟▘"], TERMINAL_TOKENS.blue),
  },
  unknown: {
    name: "Coding agent",
    mark: flatMark(["▛███▜", "█████", "▘▘ ▝▝"], TERMINAL_TOKENS.faint),
  },
};

function TerminalBanner({ banner }: { banner?: SessionBanner }) {
  if (!banner || (!banner.version && !banner.model && !banner.repo)) {
    return null;
  }
  const identity = AGENT_BANNERS[banner.agent];
  return (
    <HStack align="center" gap={3} paddingBottom={2}>
      <AgentMark mark={identity.mark} />
      <VStack align="stretch" gap={0} minWidth={0}>
        <Text {...CELL} color={TERMINAL_TOKENS.screenFg} fontWeight="semibold">
          {banner.version
            ? `${identity.name} v${banner.version}`
            : identity.name}
        </Text>
        {banner.model && (
          <Text {...CELL} color={TERMINAL_TOKENS.faint} truncate>
            {banner.model}
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

/**
 * The top of the screen. The banner IS the session-start marker: it is what
 * the agent printed when the session began, so it belongs above the FIRST
 * turn and nowhere else. While earlier turns are still out there, the same
 * slot carries the affordance that reaches them.
 */
function ScrollbackTop({
  banner,
  scrollback,
  loadedTurnCount,
}: {
  banner?: SessionBanner;
  scrollback?: TerminalViewProps["scrollback"];
  /** How many turns of the session are on screen right now. */
  loadedTurnCount: number;
}) {
  const status = scrollback?.status ?? "hidden";

  if (status === "hidden" || status === "start") {
    return (
      <>
        <TerminalBanner banner={banner} />
        {/* Only worth saying once the reader has walked back far enough to
            wonder whether there is more above them. */}
        {status === "start" && loadedTurnCount > 1 && (
          <RuleLine label="session start" />
        )}
      </>
    );
  }

  if (status === "loading") {
    return (
      <ScrollbackLine
        glyph="⋯"
        color={TERMINAL_TOKENS.faint}
        text="loading earlier turn"
      />
    );
  }

  if (status === "error") {
    return (
      <ScrollbackButton
        glyph={GLYPH.note}
        color={TERMINAL_TOKENS.red}
        text="couldn't load the earlier turn, click to retry"
        onClick={() => scrollback?.onLoadEarlier()}
      />
    );
  }

  if (status === "unavailable") {
    return (
      <ScrollbackLine
        glyph={GLYPH.note}
        color={TERMINAL_TOKENS.faint}
        text={`earlier turns unavailable, this session is longer than the ${CONVERSATION_TURN_CAP} turns the view can walk`}
      />
    );
  }

  const count = scrollback?.earlierCount ?? 0;
  return (
    <ScrollbackButton
      glyph="↑"
      color={TERMINAL_TOKENS.faint}
      text={`${count} earlier ${count === 1 ? "turn" : "turns"}, scroll to load`}
      onClick={() => scrollback?.onLoadEarlier()}
    />
  );
}

/** A single faint row, the same shape the session's other notes use. */
function ScrollbackLine({
  glyph,
  color,
  text,
}: {
  glyph: string;
  color: string;
  text: string;
}) {
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph char={glyph} color={color} />
      <Text {...CELL} color={color} flex={1} minWidth={0}>
        {text}
      </Text>
    </HStack>
  );
}

/** The same row, when it is something the reader can act on. */
function ScrollbackButton({
  glyph,
  color,
  text,
  onClick,
}: {
  glyph: string;
  color: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <HStack asChild align="flex-start" gap={2} cursor="pointer" width="100%">
      {/* A real button rather than a clickable row: it has to answer Enter
          and Space too. Typed explicitly so a surrounding form cannot make
          it a submit. */}
      <button type="button" onClick={onClick}>
        <Glyph char={glyph} color={color} />
        <Text {...CELL} color={color} flex={1} minWidth={0} textAlign="start">
          {text}
        </Text>
      </button>
    </HStack>
  );
}

/**
 * The boundary between two turns of the session: a faint rule with its label
 * inline, drawn with the rule glyph itself and clipped by overflow, the same
 * idiom {@link AsciiBox} uses, rather than a CSS border standing in for one.
 */
function TurnDividerLine({ divider }: { divider: TurnDivider }) {
  return (
    <RuleLine
      label={`turn ${divider.turnNumber}/${divider.turnCount} · ${clockTime(
        divider.atMs,
      )}`}
    />
  );
}

function RuleLine({ label }: { label: string }) {
  const rule = "─".repeat(400);
  return (
    <HStack
      gap={2}
      align="center"
      overflow="hidden"
      color={TERMINAL_TOKENS.faint}
    >
      <Text {...CELL} flexShrink={0} aria-hidden>
        ──
      </Text>
      <Text {...CELL} flexShrink={0}>
        {label}
      </Text>
      <Text
        {...CELL}
        flex={1}
        overflow="hidden"
        whiteSpace="nowrap"
        aria-hidden
      >
        {rule}
      </Text>
    </HStack>
  );
}

/** Local wall-clock time, the way a terminal stamps its own output. */
function clockTime(atMs: number): string {
  const at = new Date(atMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** The startup mark, drawn from its precomputed per-row color segments. */
function AgentMark({ mark }: { mark: MarkSpec }) {
  return (
    <VStack
      align="flex-start"
      gap={0}
      flexShrink={0}
      aria-hidden
      userSelect="none"
    >
      {mark.rows.map((segments, rowIndex) => (
        <Text
          key={rowIndex}
          {...CELL}
          fontSize={mark.fontSize ?? CELL.fontSize}
          // Block-glyph art paints exactly the 1em glyph box, so any leading
          // above 1 shows through as background hairlines between the rows
          // and visually welds letterforms shut.
          lineHeight="1"
          whiteSpace="pre"
          // Adjacent block glyphs antialias their shared fractional-pixel
          // boundary independently, compositing into hairline seams that make
          // the art look tiled. A sub-pixel ink bleed welds the cells.
          textShadow="0.4px 0 currentColor, -0.4px 0 currentColor, 0 0.4px currentColor, 0 -0.4px currentColor"
        >
          {segments.map((segment, segmentIndex) => (
            <Fragment key={segmentIndex}>
              <Text as="span" color={segment.color} bg={segment.bg}>
                {segment.text}
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
    case "system_prompt":
      return <SystemContextLine text={entry.text} chars={entry.chars} />;
    case "user_prompt":
      return <UserMessage text={entry.text} />;
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

/**
 * The session's system context (CLAUDE.md, MCP tools, skills), pinned above
 * the first prompt and collapsed by default: it is the payload every call of
 * the session carries, and expanding it is how a reader answers "what is
 * filling my context window". Collapsed it costs one line.
 */
function SystemContextLine({ text, chars }: { text: string; chars: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <VStack align="stretch" gap={0.5}>
      <HStack asChild align="flex-start" gap={2} cursor="pointer" width="100%">
        {/* A real button rather than an aria-labelled row: the header has to
            answer Enter and Space, not just a pointer. Typed explicitly so a
            surrounding form cannot make it a submit. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <Glyph char={GLYPH.note} color={TERMINAL_TOKENS.faint} />
          <Text
            {...CELL}
            color={TERMINAL_TOKENS.faint}
            flex={1}
            minWidth={0}
            textAlign="start"
          >
            session context: {chars.toLocaleString("en-US")} chars of system
            prompt and tools{" "}
            {expanded ? "(click to collapse)" : "(click to expand)"}
          </Text>
        </button>
      </HStack>
      {expanded && (
        <HStack align="flex-start" gap={2}>
          <Glyph char={GLYPH.elbow} color={TERMINAL_TOKENS.faint} />
          <Text
            {...CELL}
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            color={TERMINAL_TOKENS.faint}
            flex={1}
            minWidth={0}
          >
            {text}
          </Text>
        </HStack>
      )}
    </VStack>
  );
}

/**
 * The user's turn, which is not always the user. Agents inject blocks the human
 * never typed into this same message (a monitor firing, a hook's reminder, a
 * queued task notification), and behind the prompt caret those read as the
 * reader's own words. Each one is drawn as a note about the session instead,
 * and only what the human actually wrote keeps the caret.
 */
function UserMessage({ text }: { text: string | null }) {
  const { notices, remainder } = classifyPromptText(text ?? "");
  if (notices.length === 0) return <PromptLine text={text} />;
  return (
    <VStack align="stretch" gap={2}>
      {notices.map((notice, index) => (
        <NotificationLine
          key={`${index}-${notice.label}`}
          label={notice.label}
          body={notice.body}
        />
      ))}
      {remainder !== null && <PromptLine text={remainder} />}
    </VStack>
  );
}

/**
 * One injected block, collapsed to its own line. Same family as
 * {@link SystemContextLine}, because it is the same kind of thing: context the
 * session carried that the reader may or may not want to open.
 */
function NotificationLine({ label, body }: { label: string; body: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <VStack align="stretch" gap={0.5}>
      <HStack asChild align="flex-start" gap={2} cursor="pointer" width="100%">
        {/* A real button, typed explicitly: inside a form, the default `type`
            would be submit. */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <Glyph char={GLYPH.note} color={TERMINAL_TOKENS.faint} />
          <Text
            {...CELL}
            color={TERMINAL_TOKENS.faint}
            flex={1}
            minWidth={0}
            textAlign="start"
          >
            {label} {expanded ? "(click to collapse)" : "(click to expand)"}
          </Text>
        </button>
      </HStack>
      {expanded && (
        <HStack align="flex-start" gap={2}>
          <Glyph char={GLYPH.elbow} color={TERMINAL_TOKENS.faint} />
          <Text
            {...CELL}
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            color={TERMINAL_TOKENS.faint}
            flex={1}
            minWidth={0}
          >
            {body}
          </Text>
        </HStack>
      )}
    </VStack>
  );
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
          `Cache rebuilt: ${formatTokens(marker.cacheCreationTokens)} tokens re-sent instead of reusing ${formatTokens(marker.previousContextTokens)} tokens cached`,
        ]
      : [
          marker.color,
          `Context ${marker.label}: ${formatTokens(marker.contextTokens)} tokens`,
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
          {model && <Stat label={model} />}
          {elapsedMs > 0 && <Stat label={formatDuration(elapsedMs)} />}
          {tokens > 0 && <Stat label={`${formatTokens(tokens)} tokens`} />}
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
