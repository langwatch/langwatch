import { Box, chakra, Icon, Text, VStack } from "@chakra-ui/react";
import {
  type ChatMessage,
  isRecord,
  toolResultBodyToString,
  asPrettyJson,
} from "@langwatch/trace-contract/transcript";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuSparkles, LuWrench } from "react-icons/lu";

import { skillInvocationFromToolUse } from "../../../model/transcript/skill-invocation.ts";
import { useTranscriptRenderPorts } from "../../elements/transcript-render-ports.tsx";
import { ToolArgRow, ToolPairSection } from "../../elements/transcript/tool-pair-sections.tsx";

function hasAnsi(text: string): boolean {
  return text.includes(`${String.fromCharCode(27)}[`);
}

/**
 * OpenAI-shape tool_calls (lives on the message, not in content). These don't
 * carry a paired tool_result block the same way Anthropic does, so they
 * render solo through `ToolPairCard` with no result panel.
 */
export function OpenAIToolCallCard({
  call,
}: {
  call: NonNullable<ChatMessage["tool_calls"]>[number];
}) {
  const parsedInput = useMemo(() => {
    try {
      return JSON.parse(call.function.arguments);
    } catch {
      return call.function.arguments;
    }
  }, [call.function.arguments]);
  return <ToolPairCard name={call.function.name} input={parsedInput} id={call.id} result={null} />;
}

const IDENTIFYING_ARGS = ["file_path", "command", "path", "url", "query", "pattern"];

/**
 * The most identifying scalar argument, shown as the collapsed row's subtitle
 * ("Read · /path/to/x"): a well-known key, else the first argument.
 */
function argSummaryOf(argEntries: [string, unknown][]): string | null {
  const primary = argEntries.find(([k]) => IDENTIFYING_ARGS.includes(k)) ?? argEntries[0];
  const value = primary?.[1];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** The input as JSON text, for when it has no named arguments to list. */
function fallbackJsonOf(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return asPrettyJson(input);
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "[unserializable value]";
  }
}

function ToolPairHeader({
  title,
  summary,
  isSkill,
  isError,
  hasResult,
  open,
  glyphColor,
  onToggle,
}: {
  title: string;
  summary: string | null;
  isSkill: boolean;
  isError: boolean;
  hasResult: boolean;
  open: boolean;
  glyphColor: string;
  onToggle: () => void;
}) {
  return (
    <chakra.button
      type="button"
      display="flex"
      alignItems="center"
      gap={2}
      paddingX={2.5}
      paddingY={1.5}
      cursor="pointer"
      onClick={onToggle}
      width="full"
      _hover={{ bg: isSkill ? "purple.subtle/60" : "bg.muted" }}
      transition="background 0.12s ease"
      textAlign="left"
    >
      <Icon as={isSkill ? LuSparkles : LuWrench} boxSize={3} color={glyphColor} flexShrink={0} />
      <Text
        textStyle="xs"
        fontFamily="mono"
        color={isSkill ? "purple.fg" : "fg"}
        fontWeight="medium"
        flexShrink={0}
      >
        {title}
      </Text>
      {summary ? (
        <Text textStyle="2xs" fontFamily="mono" color="fg.subtle" truncate flex={1} minWidth={0}>
          {summary}
        </Text>
      ) : (
        <Box flex={1} />
      )}
      {isError && (
        <Text
          textStyle="2xs"
          fontWeight="600"
          color="red.fg"
          textTransform="uppercase"
          letterSpacing="0.06em"
          flexShrink={0}
        >
          error
        </Text>
      )}
      {!hasResult && (
        <Text textStyle="2xs" fontFamily="mono" color="fg.subtle" flexShrink={0}>
          no result
        </Text>
      )}
      <Icon
        as={open ? LuChevronDown : LuChevronRight}
        boxSize={3}
        color="fg.subtle"
        flexShrink={0}
      />
    </chakra.button>
  );
}

function ResultPre({ text }: { text: string }) {
  return (
    <Box
      as="pre"
      textStyle="2xs"
      fontFamily="mono"
      color="fg"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      margin={0}
      maxHeight="600px"
      overflow="auto"
    >
      {text || "—"}
    </Box>
  );
}

/**
 * Unified tool call card — pairs an Anthropic-style `tool_use` with its `tool_result`
 * (when one is available) into a single, compact, neutral card.
 */
export function ToolPairCard({
  name,
  input,
  id,
  result,
}: {
  name: string;
  input: unknown;
  id?: string;
  result: { content: unknown; isError?: boolean } | null;
}) {
  const { renderTerminalOutput } = useTranscriptRenderPorts();
  const [open, setOpen] = useState(false);

  // A `Skill` tool_use is a skill run, not an ordinary tool call — surface it
  // with its own glyph/accent and the invoked skill's name in the header so a
  // reader spots skill invocations at a glance.
  const skill = useMemo(() => skillInvocationFromToolUse({ name, input }), [name, input]);
  const isSkill = skill !== null;

  const argEntries = useMemo(() => (isRecord(input) ? Object.entries(input) : null), [input]);
  const fallbackJson = useMemo(() => fallbackJsonOf(input), [input]);
  const argSummary = useMemo(() => argSummaryOf(argEntries ?? []), [argEntries]);

  const resultBody = useMemo(
    () => (result ? toolResultBodyToString(result.content) : ""),
    [result],
  );
  const prettyResult = useMemo(() => asPrettyJson(resultBody), [resultBody]);
  // ANSI escape codes only ever show up in real terminal/tool output (Bash,
  // test runners, build tools). When they do, render the coloured terminal
  // screen instead of dumping raw escape sequences into a <pre>. Plain output
  // is unaffected — `hasAnsi` is false for it, so the render is unchanged.
  const resultHasAnsi = useMemo(() => hasAnsi(resultBody), [resultBody]);
  const isError = result?.isError === true;
  const skillBorderColor = isSkill ? "purple.muted" : "border.muted";
  const borderColor = isError ? "red.muted" : skillBorderColor;
  const skillGlyphColor = isSkill ? "purple.fg" : "fg.subtle";
  const glyphColor = isError ? "red.fg" : skillGlyphColor;

  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor={borderColor}
      bg={isSkill ? "purple.subtle/40" : "bg.subtle"}
      overflow="hidden"
    >
      <ToolPairHeader
        title={isSkill && skill?.slug ? `Skill · ${skill.slug}` : name}
        summary={isSkill ? null : argSummary}
        isSkill={isSkill}
        isError={isError}
        hasResult={!!result}
        open={open}
        glyphColor={glyphColor}
        onToggle={() => setOpen((v) => !v)}
      />
      {open && (
        <VStack align="stretch" gap={0} borderTopWidth="1px" borderTopColor="border.muted">
          <ToolPairSection label={id ? `Args · ${id}` : "Args"}>
            <ToolArgsBody argEntries={argEntries} fallbackJson={fallbackJson} />
          </ToolPairSection>
          {result && (
            <ToolPairSection
              label={isError ? "Error" : "Result"}
              tone={isError ? "error" : "default"}
            >
              {resultHasAnsi && renderTerminalOutput ? (
                renderTerminalOutput(resultBody, isError)
              ) : (
                <ResultPre text={prettyResult} />
              )}
            </ToolPairSection>
          )}
        </VStack>
      )}
    </Box>
  );
}

/** The Args section body: a row per named argument, or the raw JSON we fell back to. */
function ToolArgsBody({
  argEntries,
  fallbackJson,
}: {
  argEntries: [string, unknown][] | null;
  fallbackJson: string;
}) {
  if (argEntries && argEntries.length > 0) {
    return (
      <VStack align="stretch" gap={1}>
        {argEntries.map(([key, value]) => (
          <ToolArgRow key={key} name={key} value={value} />
        ))}
      </VStack>
    );
  }
  if (argEntries) {
    return (
      <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
        No arguments
      </Text>
    );
  }
  return (
    <Box
      as="pre"
      textStyle="2xs"
      fontFamily="mono"
      color="fg"
      whiteSpace="pre-wrap"
      wordBreak="break-word"
      bg="bg.panel"
      borderRadius="sm"
      paddingX={2}
      paddingY={1.5}
      margin={0}
    >
      {fallbackJson || "—"}
    </Box>
  );
}
