import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptEntry } from "~/server/app-layer/traces/coding-agent-transcript.derivation";
import { SimpleSlider } from "~/components/ui/slider";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../utils/formatters";
import { toolResultBodyToString } from "../transcript";
import { CLAUDE_MARK_GRADIENT, TERMINAL_TOKENS } from "./palette";
import { TerminalDiff } from "./TerminalDiff";
import { TerminalOutput } from "./TerminalOutput";
import { TerminalPatch } from "./TerminalPatch";
import type { SessionBanner } from "./sessionBanner";
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
  fontFamily: "mono",
  fontSize: "12px",
  lineHeight: "1.55",
} as const;

/**
 * The block mark Claude Code prints above the prompt when a session starts,
 * reproduced glyph-for-glyph. Three rows; the gradient is applied per
 * character so it reads as shaded rather than flat.
 */
const MARK_ROWS = [" ▐▛███▜▌", "▝▜█████▛▘", "  ▘▘ ▝▝ "] as const;

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
 * A timeline scrubber replays the session beat by beat, ticking the running
 * token + cost totals up as you travel through it.
 */
export const TerminalView = memo(function TerminalView({
  entries,
  toolSpans = NO_TOOL_SPANS,
  banner,
  sessionName,
}: TerminalViewProps) {
  const timeline = useMemo(() => buildEntryTimeline(entries), [entries]);

  // `model_call` entries carry economics for the HUD but render nothing —
  // the scrubber steps through the VISIBLE beats only.
  const visibleIndices = useMemo(
    () =>
      entries.reduce<number[]>((acc, entry, index) => {
        if (entry.kind !== "model_call") acc.push(index);
        return acc;
      }, []),
    [entries],
  );
  const lastReveal = Math.max(0, visibleIndices.length - 1);
  const [revealIndex, setRevealIndex] = useState(lastReveal);

  // Keep the reveal index valid if the entry list changes underneath us, and
  // snap to the newest beat when new entries arrive.
  useEffect(() => {
    setRevealIndex(lastReveal);
  }, [lastReveal]);

  const revealedFullIndex = visibleIndices[revealIndex] ?? -1;
  const point = timeline[revealedFullIndex];
  const modelAtReveal = useMemo(
    () => modelAt(entries, revealedFullIndex) ?? banner?.model ?? null,
    [entries, revealedFullIndex, banner?.model],
  );

  // Follow the newest revealed beat as the scrubber moves.
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screenRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [revealIndex]);

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
    <VStack align="stretch" gap={0} height="full" minHeight={0}>
      <Box
        ref={screenRef}
        flex={1}
        minHeight={0}
        overflow="auto"
        bg={TERMINAL_TOKENS.screenBg}
        color={TERMINAL_TOKENS.screenFg}
        paddingX={4}
        paddingY={3}
      >
        <VStack align="stretch" gap={2.5}>
          <TerminalBanner banner={banner} />
          {visibleIndices.slice(0, revealIndex + 1).map((fullIndex) => (
            <EntryLine
              key={fullIndex}
              entry={entries[fullIndex]!}
              toolSpans={toolSpans}
            />
          ))}
        </VStack>
      </Box>

      <StatusLine
        stepCount={visibleIndices.length}
        revealIndex={revealIndex}
        onScrub={setRevealIndex}
        tokens={point?.cumulativeTokens ?? 0}
        costUsd={point?.cumulativeCostUsd ?? 0}
        elapsedMs={point?.elapsedMs ?? 0}
        model={modelAtReveal}
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
    <VStack align="flex-start" gap={0} flexShrink={0} aria-hidden userSelect="none">
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
      return <ToolCall entry={entry} ran={toolSpans.get(entry.spanId) ?? null} />;
    case "tool_rejected":
      return <RejectedLine name={entry.name} reason={entry.reason} />;
    case "note":
      return <NoteLine level={entry.level} text={entry.text} />;
    default:
      return null;
  }
}

/** The user's prompt: `❯ what they typed`. */
function PromptLine({ text }: { text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <HStack align="flex-start" gap={2} paddingTop={1}>
      <Glyph char={GLYPH.caret} color="blue.fg" bold />
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
    patch === null && isDiffTool(name) ? extractDiffFromToolInput(entry.input) : null;

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
        <Glyph char={GLYPH.bullet} color={isError ? "red.fg" : TERMINAL_TOKENS.faint} />
        <Text {...CELL} color={TERMINAL_TOKENS.screenFg} flex={1} minWidth={0}>
          <Text as="span" fontWeight="bold">
            {name}
          </Text>
          {arg ? (
            <Text as="span" color={TERMINAL_TOKENS.faint}>
              {`(${truncateArg(arg)})`}
            </Text>
          ) : null}
          {entry.agentId !== null && (
            <Text as="span" color={TERMINAL_TOKENS.faint}>
              {" · sub-agent"}
            </Text>
          )}
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
        ) : ranOutput !== null ? (
          <TerminalOutput text={ranOutput} isError={isError} maxHeight="360px" />
        ) : transcriptOutput !== null && transcriptOutput.trim() !== "" ? (
          <TerminalOutput text={transcriptOutput} isError={isError} maxHeight="360px" />
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
      <Glyph char={GLYPH.denied} color="red.fg" />
      <Text {...CELL} color="red.fg" flex={1} minWidth={0}>
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
    level === "error" ? "red.fg" : level === "warning" ? "yellow.fg" : TERMINAL_TOKENS.faint;
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph char={level === "error" ? GLYPH.bullet : GLYPH.note} color={color} />
      <Text {...CELL} color={color} flex={1} minWidth={0} wordBreak="break-word">
        {text}
      </Text>
    </HStack>
  );
}

/** The `⎿` elbow row: a result, indented under the call it belongs to. */
function ResultLine({ children }: { children: React.ReactNode }) {
  return (
    <HStack align="flex-start" gap={2} paddingLeft={4}>
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
 * The bottom status line — the CLI's own idiom (`⏵⏵ auto mode on · …`), doing
 * real work here: it's the scrubber, it names the session where Claude Code
 * would show your input, and it reports what the session had cost by the beat
 * you're parked on. Fixed to the bottom of the pane — it does not scroll away
 * with the transcript above it.
 */
function StatusLine({
  stepCount,
  revealIndex,
  onScrub,
  tokens,
  costUsd,
  elapsedMs,
  model,
  sessionName,
}: {
  stepCount: number;
  revealIndex: number;
  onScrub: (index: number) => void;
  tokens: number;
  costUsd: number;
  elapsedMs: number;
  model?: string | null;
  sessionName?: string | null;
}) {
  const scrubbable = stepCount > 1;
  return (
    <VStack
      align="stretch"
      gap={1.5}
      paddingX={4}
      paddingY={2}
      borderTopWidth="1px"
      borderColor={TERMINAL_TOKENS.border}
      bg={TERMINAL_TOKENS.frameBg}
      flexShrink={0}
    >
      {scrubbable && (
        // Chakra's Slider.Root doesn't take `aria-label` (it lands on the thumb
        // via the hidden input), so the accessible name goes on the group.
        <Box role="group" aria-label="Scrub session timeline">
          <SimpleSlider
            size="sm"
            min={0}
            max={stepCount - 1}
            step={1}
            value={[revealIndex]}
            onValueChange={(details) => {
              const next = details.value[0];
              if (typeof next === "number") onScrub(next);
            }}
          />
        </Box>
      )}
      <HStack gap={2} justify="space-between" flexWrap="wrap">
        <HStack gap={2} minWidth={0}>
          <Text {...CELL} color={TERMINAL_TOKENS.accent} flexShrink={0} aria-hidden>
            ⏵⏵
          </Text>
          <Text
            {...CELL}
            color={TERMINAL_TOKENS.screenFg}
            fontWeight="medium"
            truncate
            minWidth={0}
          >
            {sessionName ?? "Untitled session"}
          </Text>
          <Text {...CELL} color={TERMINAL_TOKENS.faint} flexShrink={0}>
            {`step ${Math.min(revealIndex + 1, stepCount)}/${stepCount}`}
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
