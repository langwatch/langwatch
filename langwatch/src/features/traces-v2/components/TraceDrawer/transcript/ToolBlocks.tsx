import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { type ReactNode, useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuWrench } from "react-icons/lu";
import { toolResultBodyToString, tryPrettyJson } from "./parsing";
import type { ChatMessage } from "./types";

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
  return (
    <ToolPairCard
      name={call.function.name}
      input={parsedInput}
      id={call.id}
      result={null}
    />
  );
}

/**
 * Unified tool call card — pairs an Anthropic-style `tool_use` with its
 * `tool_result` (when one is available) into a single, compact, neutral
 * card. Collapsed by default: just one line showing the tool name and a
 * primary-arg summary (e.g. `Read · /path/to/file.txt`). Expanded shows
 * the full arguments table and the result body in two stacked sections.
 *
 * Visual choices:
 *   • Neutral surface (bg.subtle / border.muted) — no orange. Tools are
 *     supporting context, not the conversation, so they shouldn't shout.
 *   • Errors get a red accent (border + label only) so they still stand
 *     out without painting the entire chain in alarm colors.
 *   • Single header for both call + result so the eye groups them as one
 *     operation. No more two-card "wall" per turn.
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
  const [open, setOpen] = useState(false);

  const argEntries = useMemo<Array<[string, unknown]> | null>(() => {
    if (input && typeof input === "object" && !Array.isArray(input)) {
      return Object.entries(input as Record<string, unknown>);
    }
    return null;
  }, [input]);

  const fallbackJson = useMemo(() => {
    if (input == null) return "";
    if (typeof input === "string") return tryPrettyJson(input);
    try {
      return JSON.stringify(input, null, 2);
    } catch {
      return String(input);
    }
  }, [input]);

  const argSummary = useMemo(() => {
    if (!argEntries || argEntries.length === 0) return null;
    // Pull the most identifying single-arg out as a header subtitle —
    // makes the row scannable while collapsed (e.g. "Read · /path/to/x").
    const primary =
      argEntries.find(
        ([k]) =>
          k === "file_path" ||
          k === "command" ||
          k === "path" ||
          k === "url" ||
          k === "query" ||
          k === "pattern",
      ) ?? argEntries[0];
    if (!primary) return null;
    const [, val] = primary;
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    return null;
  }, [argEntries]);

  const resultBody = useMemo(
    () => (result ? toolResultBodyToString(result.content) : ""),
    [result],
  );
  const prettyResult = useMemo(() => tryPrettyJson(resultBody), [resultBody]);
  const isError = result?.isError === true;

  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor={isError ? "red.muted" : "border.muted"}
      bg="bg.subtle"
      overflow="hidden"
    >
      <HStack
        as="button"
        type="button"
        gap={2}
        paddingX={2.5}
        paddingY={1.5}
        cursor="pointer"
        onClick={() => setOpen((v) => !v)}
        width="full"
        _hover={{ bg: "bg.muted" }}
        transition="background 0.12s ease"
        textAlign="left"
      >
        <Icon
          as={LuWrench}
          boxSize={3}
          color={isError ? "red.fg" : "fg.subtle"}
          flexShrink={0}
        />
        <Text
          textStyle="xs"
          fontFamily="mono"
          color="fg"
          fontWeight="medium"
          flexShrink={0}
        >
          {name}
        </Text>
        {argSummary ? (
          <Text
            textStyle="2xs"
            fontFamily="mono"
            color="fg.subtle"
            truncate
            flex={1}
            minWidth={0}
          >
            {argSummary}
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
        {!result && (
          <Text
            textStyle="2xs"
            fontFamily="mono"
            color="fg.subtle"
            flexShrink={0}
          >
            no result
          </Text>
        )}
        <Icon
          as={open ? LuChevronDown : LuChevronRight}
          boxSize={3}
          color="fg.subtle"
          flexShrink={0}
        />
      </HStack>
      {open && (
        <VStack
          align="stretch"
          gap={0}
          borderTopWidth="1px"
          borderTopColor="border.muted"
        >
          <ToolPairSection label={id ? `Args · ${id}` : "Args"}>
            {argEntries && argEntries.length > 0 ? (
              <VStack align="stretch" gap={1}>
                {argEntries.map(([key, value]) => (
                  <ToolArgRow key={key} name={key} value={value} />
                ))}
              </VStack>
            ) : argEntries && argEntries.length === 0 ? (
              <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
                No arguments
              </Text>
            ) : (
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
            )}
          </ToolPairSection>
          {result && (
            <ToolPairSection
              label={isError ? "Error" : "Result"}
              tone={isError ? "error" : "default"}
            >
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
                {prettyResult || "—"}
              </Box>
            </ToolPairSection>
          )}
        </VStack>
      )}
    </Box>
  );
}

function ToolPairSection({
  label,
  tone = "default",
  children,
}: {
  label: string;
  tone?: "default" | "error";
  children: ReactNode;
}) {
  return (
    <Box
      paddingX={2.5}
      paddingY={1.5}
      _notFirst={{ borderTopWidth: "1px", borderTopColor: "border.muted" }}
    >
      <Text
        textStyle="2xs"
        fontWeight="600"
        color={tone === "error" ? "red.fg" : "fg.subtle"}
        textTransform="uppercase"
        letterSpacing="0.06em"
        marginBottom={1}
      >
        {label}
      </Text>
      {children}
    </Box>
  );
}

/**
 * Single argument row inside a tool_use card. Renders the key as a small
 * label and the value with shape-appropriate formatting:
 *   - strings stay as prose / monospace depending on length
 *   - objects/arrays render as a compact inline JSON pre-block
 *   - primitives render as monospace tokens
 */
function ToolArgRow({ name, value }: { name: string; value: unknown }) {
  const valueDisplay = useMemo(() => {
    if (value == null) {
      return { kind: "primitive" as const, text: "null" };
    }
    if (typeof value === "string") {
      return { kind: "string" as const, text: value };
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return { kind: "primitive" as const, text: String(value) };
    }
    try {
      return { kind: "json" as const, text: JSON.stringify(value, null, 2) };
    } catch {
      return { kind: "primitive" as const, text: String(value) };
    }
  }, [value]);

  return (
    <HStack align="flex-start" gap={2} minWidth={0}>
      <Text
        textStyle="2xs"
        fontFamily="mono"
        color="fg.subtle"
        fontWeight="500"
        flexShrink={0}
        minWidth="60px"
      >
        {name}
      </Text>
      {valueDisplay.kind === "string" && valueDisplay.text.length < 120 ? (
        <Text
          textStyle="xs"
          fontFamily="mono"
          color="fg"
          wordBreak="break-word"
          flex={1}
          minWidth={0}
        >
          {valueDisplay.text}
        </Text>
      ) : valueDisplay.kind === "primitive" ? (
        <Text textStyle="xs" fontFamily="mono" color="fg" flex={1}>
          {valueDisplay.text}
        </Text>
      ) : (
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
          paddingY={1}
          margin={0}
          maxHeight="400px"
          overflow="auto"
          flex={1}
          minWidth={0}
        >
          {valueDisplay.text}
        </Box>
      )}
    </HStack>
  );
}
