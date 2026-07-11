import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { SimpleSlider } from "~/components/ui/slider";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../utils/formatters";
import {
  type ContentBlock,
  type ConversationTurn,
  pairToolBlocks,
  toolResultBodyToString,
} from "../transcript";
import { TERMINAL_TOKENS } from "./palette";
import { TerminalDiff } from "./TerminalDiff";
import { TerminalOutput } from "./TerminalOutput";
import { TerminalPatch } from "./TerminalPatch";
import {
  buildTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  type TerminalStep,
  toolPrimaryArg,
} from "./terminalSession";
import type {
  SessionEvents,
  SessionNote,
  ToolRejection,
} from "./sessionEvents";
import { parsePatchHunks, type TerminalToolSpan } from "./toolSpans";

/** What actually ran, keyed by the `tool_use_id` the model called it with. */
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
  /** Thinking / extended reasoning. */
  thinking: "✻",
  /** Session-level notes (system prompt, recap). */
  note: "※",
} as const;

/** Everything on the screen is one monospace size — a terminal has one font. */
const CELL = {
  fontFamily: "mono",
  fontSize: "12px",
  lineHeight: "1.55",
} as const;

interface TerminalViewProps {
  /** Session beats, in order. Build from the trace's spans at the wiring site. */
  steps: TerminalStep[];
  /**
   * What each tool call actually did, from Claude's real tool spans. The
   * transcript only carries what the model was TOLD a tool returned; these
   * carry what ran — real stdout, a real patch, how long it took, whether it
   * failed. Optional: without it the view falls back to the transcript.
   */
  toolSpans?: ToolSpanIndex;
  /**
   * The parts of the session that exist only as LOGS — a tool the user denied
   * (which produces no span at all), API errors, refusals, a mid-session
   * compaction. Spans and logs complement each other; without these the turn is
   * missing its most interesting moments.
   */
  sessionEvents?: SessionEvents;
  meta?: {
    model?: string;
    cwd?: string;
  };
}

const NO_SESSION_EVENTS: SessionEvents = {
  rejectionsByToolUseId: new Map(),
  notes: [],
};

/**
 * A recreation of how a Claude Code session looked in the terminal.
 *
 * Deliberately NOT a "terminal widget": no window frame, no traffic lights, no
 * title bar. Claude Code doesn't draw those — it prints into the terminal you
 * already have, and its entire hierarchy is carried by four glyphs (see
 * {@link GLYPH}) at one monospace size. Adding chrome around it makes it read
 * as a screenshot of a terminal rather than as the session itself.
 *
 * A timeline scrubber replays the session beat by beat, ticking the running
 * token + cost totals up as you travel through it.
 */
export const TerminalView = memo(function TerminalView({
  steps,
  toolSpans = NO_TOOL_SPANS,
  sessionEvents = NO_SESSION_EVENTS,
  meta,
}: TerminalViewProps) {
  const timeline = useMemo(() => buildTimeline(steps), [steps]);
  const lastIndex = Math.max(0, steps.length - 1);
  const [revealIndex, setRevealIndex] = useState(lastIndex);

  // Keep the reveal index valid if the step list changes underneath us, and
  // snap to the newest beat when new steps arrive.
  useEffect(() => {
    setRevealIndex(lastIndex);
  }, [lastIndex]);

  const revealed = steps.slice(0, revealIndex + 1);
  const point = timeline[revealIndex];

  // Follow the newest revealed beat as the scrubber moves.
  const screenRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = screenRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [revealIndex]);

  if (steps.length === 0) {
    return (
      <VStack
        align="center"
        justify="center"
        height="full"
        bg={TERMINAL_TOKENS.screenBg}
      >
        <Text {...CELL} color={TERMINAL_TOKENS.faint}>
          No terminal session recorded for this turn
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
          {sessionEvents.notes.map((note, index) => (
            <SessionNoteLine key={`note-${index}`} note={note} />
          ))}
          {revealed.map((step, index) => (
            <StepView
              key={index}
              step={step}
              toolSpans={toolSpans}
              rejections={sessionEvents.rejectionsByToolUseId}
            />
          ))}
        </VStack>
      </Box>

      <StatusLine
        stepCount={steps.length}
        revealIndex={revealIndex}
        onScrub={setRevealIndex}
        tokens={point?.cumulativeTokens ?? 0}
        costUsd={point?.cumulativeCostUsd ?? 0}
        elapsedMs={point?.elapsedMs ?? 0}
        model={steps[revealIndex]?.model ?? meta?.model}
        cwd={meta?.cwd}
      />
    </VStack>
  );
});

function StepView({
  step,
  toolSpans,
  rejections,
}: {
  step: TerminalStep;
  toolSpans: ToolSpanIndex;
  rejections: ReadonlyMap<string, ToolRejection>;
}) {
  const { turn } = step;
  if (turn.kind === "user") return <PromptLine turn={turn} />;
  if (turn.kind === "system") return <SystemNote turn={turn} />;
  return (
    <AssistantBlocks
      turn={turn}
      toolSpans={toolSpans}
      rejections={rejections}
    />
  );
}

/** The user's prompt: `❯ what they typed`. */
function PromptLine({
  turn,
}: {
  turn: Extract<ConversationTurn, { kind: "user" }>;
}) {
  const text = useMemo(() => textOf(turn.blocks), [turn.blocks]);
  if (!text.trim()) return null;
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

function SystemNote({
  turn,
}: {
  turn: Extract<ConversationTurn, { kind: "system" }>;
}) {
  const text = useMemo(() => textOf(turn.blocks), [turn.blocks]);
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph char={GLYPH.note} color={TERMINAL_TOKENS.faint} />
      <Text {...CELL} color={TERMINAL_TOKENS.faint}>
        {`system prompt (${text.length.toLocaleString()} chars)`}
      </Text>
    </HStack>
  );
}

/** One assistant beat: prose, thinking, and its tool calls with output. */
function AssistantBlocks({
  turn,
  toolSpans,
  rejections,
}: {
  turn: Extract<ConversationTurn, { kind: "assistant" }>;
  toolSpans: ToolSpanIndex;
  rejections: ReadonlyMap<string, ToolRejection>;
}) {
  const items = useMemo(() => pairToolBlocks(turn.blocks), [turn.blocks]);
  return (
    <VStack align="stretch" gap={2.5}>
      {items.map((item, index) => {
        if (item.kind === "tool_pair") {
          return (
            <ToolCall
              key={index}
              name={item.use.name}
              input={item.use.input}
              result={item.result}
              ran={
                item.use.id !== undefined
                  ? toolSpans.get(item.use.id) ?? null
                  : null
              }
              rejected={
                item.use.id !== undefined
                  ? rejections.get(item.use.id) ?? null
                  : null
              }
            />
          );
        }
        if (item.kind === "orphan_result") {
          return (
            <ResultLine key={index}>
              <ToolResultBody
                content={item.result.content}
                isError={item.result.isError}
              />
            </ResultLine>
          );
        }
        return <BlockLine key={index} block={item.block} />;
      })}
    </VStack>
  );
}

function BlockLine({ block }: { block: ContentBlock }) {
  if (block.kind === "text") {
    // Assistant prose opens with the same bullet a tool call does — in the CLI
    // they're peers in one stream, not separate kinds of thing.
    return (
      <HStack align="flex-start" gap={2}>
        <Glyph char={GLYPH.bullet} color="green.fg" />
        <Text
          {...CELL}
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          color={TERMINAL_TOKENS.screenFg}
          flex={1}
          minWidth={0}
        >
          {block.text}
        </Text>
      </HStack>
    );
  }
  if (block.kind === "thinking") {
    return (
      <HStack align="flex-start" gap={2}>
        <Glyph char={GLYPH.thinking} color={TERMINAL_TOKENS.faint} />
        <Text
          {...CELL}
          fontStyle="italic"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          color={TERMINAL_TOKENS.faint}
          flex={1}
          minWidth={0}
        >
          {block.text}
        </Text>
      </HStack>
    );
  }
  // Anything the transcript couldn't classify still gets printed rather than
  // dropped — a terminal shows you what came back, even when it's odd.
  if (block.kind === "raw") {
    return (
      <Text {...CELL} color={TERMINAL_TOKENS.faint}>
        {safeStringify(block.data)}
      </Text>
    );
  }
  return null;
}

/**
 * `⏺ Tool(arg)` with its result hanging underneath on the `⎿` elbow. The bullet
 * is the only status signal — green ran, red failed — exactly as in the CLI.
 */
function ToolCall({
  name,
  input,
  result,
  ran,
  rejected,
}: {
  name: string;
  input: unknown;
  result: Extract<ContentBlock, { kind: "tool_result" }> | null;
  /** The tool's real span, when we have it. */
  ran: TerminalToolSpan | null;
  /**
   * Set when the user DENIED this tool. It never ran, so there is no span and no
   * result — only a `tool_decision` log. Without this the call would render as a
   * tool that mysteriously produced no output.
   */
  rejected: ToolRejection | null;
}) {
  // The span knows the command it really ran; the transcript only has what the
  // model asked for. Prefer the former.
  const arg = useMemo(
    () => ran?.bashCommand ?? ran?.filePath ?? toolPrimaryArg(input),
    [ran, input],
  );
  const isError = rejected !== null || (ran?.isError ?? result?.isError === true);

  // Edit emits a real structured patch on its span. Only fall back to diffing
  // the tool's own `old_string` → `new_string` when that patch isn't there.
  const patch = useMemo(() => parsePatchHunks(ran?.diff ?? null), [ran?.diff]);
  const synthesizedDiff = useMemo(
    () =>
      patch === null && isDiffTool(name)
        ? extractDiffFromToolInput(input)
        : null,
    [patch, name, input],
  );

  // Bash stdout / a file's content, as it actually came back — not the capped
  // echo the model was handed.
  const ranOutput = ran?.output ?? ran?.content ?? null;

  return (
    <VStack align="stretch" gap={0.5}>
      <HStack align="flex-start" gap={2}>
        <Glyph char={GLYPH.bullet} color={isError ? "red.fg" : "green.fg"} />
        <Text {...CELL} color={TERMINAL_TOKENS.screenFg} flex={1} minWidth={0}>
          <Text as="span" fontWeight="bold">
            {ran?.toolName ?? name}
          </Text>
          {arg ? (
            <Text as="span" color={TERMINAL_TOKENS.faint}>
              {`(${truncateArg(arg)})`}
            </Text>
          ) : null}
        </Text>
        {ran !== null && ran.durationMs > 0 && (
          <Text {...CELL} color={TERMINAL_TOKENS.faint} flexShrink={0}>
            {formatDuration(ran.durationMs)}
          </Text>
        )}
      </HStack>

      <ResultLine>
        {rejected ? (
          <Text {...CELL} color="red.fg">
            {rejected.source === "user_abort"
              ? "Aborted by the user — this tool never ran"
              : "Denied by the user — this tool never ran"}
          </Text>
        ) : patch ? (
          <TerminalPatch hunks={patch} filePath={ran?.filePath} />
        ) : synthesizedDiff ? (
          <TerminalDiff
            oldText={synthesizedDiff.oldText}
            newText={synthesizedDiff.newText}
            filePath={synthesizedDiff.filePath}
          />
        ) : ranOutput !== null ? (
          <TerminalOutput text={ranOutput} isError={isError} maxHeight="360px" />
        ) : result ? (
          <ToolResultBody content={result.content} isError={result.isError} />
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
 * A session-level fact with no span of its own — an API error, a refusal, a
 * mid-session context compaction. These live only in the logs, so without them
 * the session reads as if they never happened.
 */
function SessionNoteLine({ note }: { note: SessionNote }) {
  const isError = note.kind !== "compaction";
  return (
    <HStack align="flex-start" gap={2}>
      <Glyph
        char={isError ? GLYPH.bullet : GLYPH.note}
        color={isError ? "red.fg" : TERMINAL_TOKENS.faint}
      />
      <Text
        {...CELL}
        color={isError ? "red.fg" : TERMINAL_TOKENS.faint}
        flex={1}
        minWidth={0}
        wordBreak="break-word"
      >
        {note.text}
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

function ToolResultBody({
  content,
  isError,
}: {
  content: unknown;
  isError?: boolean;
}) {
  const text = useMemo(() => toolResultBodyToString(content), [content]);
  if (!text.trim()) {
    return (
      <Text {...CELL} color={TERMINAL_TOKENS.faint}>
        (empty)
      </Text>
    );
  }
  return <TerminalOutput text={text} isError={isError} maxHeight="360px" />;
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
 * real work here: it's the scrubber, and it reports what the session had cost
 * by the beat you're parked on.
 */
function StatusLine({
  stepCount,
  revealIndex,
  onScrub,
  tokens,
  costUsd,
  elapsedMs,
  model,
  cwd,
}: {
  stepCount: number;
  revealIndex: number;
  onScrub: (index: number) => void;
  tokens: number;
  costUsd: number;
  elapsedMs: number;
  model?: string;
  cwd?: string;
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
          <Text {...CELL} color="blue.fg" flexShrink={0} aria-hidden>
            ⏵⏵
          </Text>
          <Text {...CELL} color={TERMINAL_TOKENS.faint}>
            {`step ${Math.min(revealIndex + 1, stepCount)}/${stepCount}`}
          </Text>
          {cwd && (
            <Text {...CELL} color={TERMINAL_TOKENS.faint} truncate minWidth={0}>
              {`· ${cwd}`}
            </Text>
          )}
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
      color={accent ? "green.fg" : TERMINAL_TOKENS.faint}
      fontWeight={accent ? "semibold" : undefined}
    >
      {label}
    </Text>
  );
}

/** Join a turn's text blocks into a single string. */
function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter(
      (b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text",
    )
    .map((b) => b.text)
    .join("\n");
}

function truncateArg(arg: string): string {
  const oneLine = arg.replace(/\s+/g, " ").trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
