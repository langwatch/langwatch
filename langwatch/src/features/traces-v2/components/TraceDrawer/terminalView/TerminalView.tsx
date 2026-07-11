import { Box, Circle, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { CornerDownRight, TerminalSquare } from "lucide-react";
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
import { AnsiText } from "./AnsiText";
import { TERMINAL_TOKENS } from "./palette";
import { TerminalDiff } from "./TerminalDiff";
import { TerminalOutput } from "./TerminalOutput";
import {
  buildTimeline,
  extractDiffFromToolInput,
  isDiffTool,
  type TerminalStep,
  toolPrimaryArg,
} from "./terminalSession";

interface TerminalViewProps {
  /** Session beats, in order. Build from the trace's turns at the wiring site. */
  steps: TerminalStep[];
  meta?: {
    model?: string;
    osType?: string;
    terminalType?: string;
    cwd?: string;
    title?: string;
  };
}

/**
 * A terminal-style recreation of how a Claude Code session looked: a window
 * frame, the user's prompts, the assistant's replies, and each tool call with
 * its output rendered the way the CLI shows it (ANSI-coloured output, red/green
 * code diffs). A timeline scrubber replays the session beat by beat, ticking up
 * the running token and cost totals as you travel through it.
 *
 * Takes the already-shaped `ConversationTurn` data (the transcript module's
 * shape, produced by `groupMessagesIntoTurns`) so it reuses the exact turn
 * model the conversation view uses rather than reinventing one.
 */
export const TerminalView = memo(function TerminalView({
  steps,
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

  const title =
    meta?.title ??
    ["claude", meta?.cwd, meta?.terminalType].filter(Boolean).join("  ");

  return (
    <VStack align="stretch" gap={0} height="full" minHeight={0}>
      <TitleBar title={title} osType={meta?.osType} />

      <Box
        ref={screenRef}
        flex={1}
        minHeight={0}
        overflow="auto"
        bg={TERMINAL_TOKENS.screenBg}
        color={TERMINAL_TOKENS.screenFg}
        paddingX={3}
        paddingY={3}
      >
        <VStack align="stretch" gap={3}>
          {revealed.map((step, index) => (
            <StepView key={index} step={step} />
          ))}
        </VStack>
      </Box>

      <TimelineBar
        stepCount={steps.length}
        revealIndex={revealIndex}
        onScrub={setRevealIndex}
        tokens={point?.cumulativeTokens ?? 0}
        costUsd={point?.cumulativeCostUsd ?? 0}
        elapsedMs={point?.elapsedMs ?? 0}
        model={steps[revealIndex]?.model ?? meta?.model}
      />
    </VStack>
  );
});

function TitleBar({ title, osType }: { title: string; osType?: string }) {
  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      borderBottomWidth="1px"
      borderColor={TERMINAL_TOKENS.border}
      bg={TERMINAL_TOKENS.frameBg}
      flexShrink={0}
    >
      {/* Traffic-light window dots — pure chrome, semantic tokens. */}
      <HStack gap={1.5} flexShrink={0}>
        <Circle size="10px" bg="red.solid" opacity={0.85} />
        <Circle size="10px" bg="yellow.solid" opacity={0.85} />
        <Circle size="10px" bg="green.solid" opacity={0.85} />
      </HStack>
      <Icon as={TerminalSquare} boxSize="13px" color={TERMINAL_TOKENS.faint} />
      <Text
        textStyle="2xs"
        fontFamily="mono"
        color={TERMINAL_TOKENS.faint}
        truncate
        flex={1}
        minWidth={0}
      >
        {title}
      </Text>
      {osType && (
        <Text textStyle="2xs" fontFamily="mono" color={TERMINAL_TOKENS.faint}>
          {osType}
        </Text>
      )}
    </HStack>
  );
}

function StepView({ step }: { step: TerminalStep }) {
  const { turn } = step;
  if (turn.kind === "user") return <PromptBlock turn={turn} />;
  if (turn.kind === "system") return <SystemNote turn={turn} />;
  return <AssistantBlocks turn={turn} />;
}

/** The user's prompt, in Claude Code's bordered `>` input box. */
function PromptBlock({
  turn,
}: {
  turn: Extract<ConversationTurn, { kind: "user" }>;
}) {
  const text = useMemo(() => textOf(turn.blocks), [turn.blocks]);
  if (!text.trim()) return null;
  return (
    <Box
      borderWidth="1px"
      borderColor={TERMINAL_TOKENS.border}
      borderRadius="md"
      bg={TERMINAL_TOKENS.frameBg}
      paddingX={2.5}
      paddingY={1.5}
    >
      <HStack align="flex-start" gap={2}>
        <Text
          fontFamily="mono"
          fontSize="12px"
          color="blue.fg"
          fontWeight="bold"
          flexShrink={0}
          userSelect="none"
        >
          {">"}
        </Text>
        <Text
          fontFamily="mono"
          fontSize="12px"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          color={TERMINAL_TOKENS.screenFg}
          flex={1}
          minWidth={0}
        >
          {text}
        </Text>
      </HStack>
    </Box>
  );
}

function SystemNote({
  turn,
}: {
  turn: Extract<ConversationTurn, { kind: "system" }>;
}) {
  const text = useMemo(() => textOf(turn.blocks), [turn.blocks]);
  const chars = text.length;
  return (
    <Text
      fontFamily="mono"
      fontSize="12px"
      color={TERMINAL_TOKENS.faint}
      fontStyle="italic"
    >
      {`⚙ system prompt (${chars} chars)`}
    </Text>
  );
}

/** One assistant beat: prose, thinking, and its tool calls with output. */
function AssistantBlocks({
  turn,
}: {
  turn: Extract<ConversationTurn, { kind: "assistant" }>;
}) {
  const items = useMemo(() => pairToolBlocks(turn.blocks), [turn.blocks]);
  return (
    <VStack align="stretch" gap={2}>
      {items.map((item, index) => {
        if (item.kind === "tool_pair") {
          return (
            <ToolCallBlock
              key={index}
              name={item.use.name}
              input={item.use.input}
              result={item.result}
            />
          );
        }
        if (item.kind === "orphan_result") {
          return (
            <ToolResultBody
              key={index}
              content={item.result.content}
              isError={item.result.isError}
            />
          );
        }
        return <BlockLine key={index} block={item.block} />;
      })}
    </VStack>
  );
}

function BlockLine({ block }: { block: ContentBlock }) {
  if (block.kind === "text") {
    return (
      <Text
        fontFamily="mono"
        fontSize="12px"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
        color={TERMINAL_TOKENS.screenFg}
        userSelect="text"
      >
        {block.text}
      </Text>
    );
  }
  if (block.kind === "thinking") {
    return (
      <HStack align="flex-start" gap={2}>
        <Text
          fontFamily="mono"
          fontSize="12px"
          color={TERMINAL_TOKENS.faint}
          flexShrink={0}
          userSelect="none"
        >
          {"✻"}
        </Text>
        <Text
          fontFamily="mono"
          fontSize="12px"
          fontStyle="italic"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
          color={TERMINAL_TOKENS.faint}
          flex={1}
          minWidth={0}
          userSelect="text"
        >
          {block.text}
        </Text>
      </HStack>
    );
  }
  // media / raw — render a compact JSON-ish line rather than dropping it.
  return (
    <Text fontFamily="mono" fontSize="12px" color={TERMINAL_TOKENS.faint}>
      {block.kind === "media" ? "[media]" : safeStringify(block.data)}
    </Text>
  );
}

function ToolCallBlock({
  name,
  input,
  result,
}: {
  name: string;
  input: unknown;
  result: Extract<ContentBlock, { kind: "tool_result" }> | null;
}) {
  const arg = useMemo(() => toolPrimaryArg(input), [input]);
  const isError = result?.isError === true;
  const diff = useMemo(
    () => (isDiffTool(name) ? extractDiffFromToolInput(input) : null),
    [name, input],
  );

  return (
    <VStack align="stretch" gap={1}>
      {/* ⏺ Tool(primaryArg) — the call line, bullet green (ok) or red (error). */}
      <HStack align="baseline" gap={2}>
        <Text
          fontSize="12px"
          lineHeight="1.55"
          color={isError ? "red.fg" : "green.fg"}
          flexShrink={0}
          userSelect="none"
        >
          {"⏺"}
        </Text>
        <Text
          fontFamily="mono"
          fontSize="12px"
          color={TERMINAL_TOKENS.screenFg}
        >
          <Text as="span" fontWeight="bold">
            {name}
          </Text>
          {arg ? (
            <Text as="span" color={TERMINAL_TOKENS.faint}>
              {`(${truncateArg(arg)})`}
            </Text>
          ) : null}
        </Text>
      </HStack>

      {/* ⎿ result, indented under the call. */}
      <HStack align="stretch" gap={2} paddingLeft={1}>
        <Icon
          as={CornerDownRight}
          boxSize="13px"
          color={TERMINAL_TOKENS.faint}
          flexShrink={0}
          marginTop="2px"
        />
        <Box flex={1} minWidth={0}>
          {diff ? (
            <TerminalDiff
              oldText={diff.oldText}
              newText={diff.newText}
              filePath={diff.filePath}
            />
          ) : result ? (
            <ToolResultBody content={result.content} isError={result.isError} />
          ) : (
            <Text
              fontFamily="mono"
              fontSize="12px"
              color={TERMINAL_TOKENS.faint}
              fontStyle="italic"
            >
              (no output)
            </Text>
          )}
        </Box>
      </HStack>
    </VStack>
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
      <Text
        fontFamily="mono"
        fontSize="12px"
        color={TERMINAL_TOKENS.faint}
        fontStyle="italic"
      >
        (empty)
      </Text>
    );
  }
  return <TerminalOutput text={text} isError={isError} maxHeight="360px" />;
}

function TimelineBar({
  stepCount,
  revealIndex,
  onScrub,
  tokens,
  costUsd,
  elapsedMs,
  model,
}: {
  stepCount: number;
  revealIndex: number;
  onScrub: (index: number) => void;
  tokens: number;
  costUsd: number;
  elapsedMs: number;
  model?: string;
}) {
  const scrubbable = stepCount > 1;
  return (
    <VStack
      align="stretch"
      gap={1.5}
      paddingX={3}
      paddingY={2}
      borderTopWidth="1px"
      borderColor={TERMINAL_TOKENS.border}
      bg={TERMINAL_TOKENS.frameBg}
      flexShrink={0}
    >
      <HStack gap={3} justify="space-between">
        <Text textStyle="2xs" color={TERMINAL_TOKENS.faint} fontFamily="mono">
          {`step ${Math.min(revealIndex + 1, stepCount)}/${stepCount}`}
        </Text>
        <HStack gap={3} flexWrap="wrap" justify="flex-end">
          {model && <HudStat label={abbreviateModel(model)} />}
          {elapsedMs > 0 && <HudStat label={formatDuration(elapsedMs)} />}
          {tokens > 0 && <HudStat label={`${formatTokens(tokens)} tok`} />}
          {costUsd > 0 && <HudStat label={formatCost(costUsd)} accent />}
        </HStack>
      </HStack>
      {scrubbable && (
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
          aria-label="Scrub session timeline"
        />
      )}
    </VStack>
  );
}

function HudStat({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <Text
      textStyle="2xs"
      fontFamily="mono"
      color={accent ? "green.fg" : TERMINAL_TOKENS.faint}
      fontWeight={accent ? "600" : undefined}
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
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
