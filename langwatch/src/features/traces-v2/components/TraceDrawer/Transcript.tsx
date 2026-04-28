/**
 * Shared transcript-rendering primitives used by both:
 *   - IOViewer  — renders trace input/output panels
 *   - ConversationView (and any future chat-display surface)
 *
 * Owns the parsing of GenAI / Anthropic chat-shape content (typed blocks,
 * embedded-JSON strings), the grouping of raw messages into logical turns
 * (so tool_use / tool_result wrappers fold back into the assistant turn
 * that initiated them), and the rendering primitives:
 *   • UserTurnBubble — right-aligned user prose
 *   • AssistantTurnCard — assistant operation chain (thinking + text + tools)
 *   • SystemTurnView — system / developer messages
 *   • ThreadedTurnView — Gmail-style collapsible row for one turn
 *   • VirtualizedChatList — virtualized turn list for long transcripts
 */
import { useState, useMemo, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { keyframes } from "@emotion/react";
import { Box, Button, Flex, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import {
  LuBrain,
  LuChevronDown,
  LuChevronRight,
  LuCode,
  LuBot,
  LuSettings,
  LuUser,
  LuWrench,
} from "react-icons/lu";
import type { IconType } from "react-icons";
import { RenderedMarkdown } from "./MarkdownView";
import {
  getDisplayRoleVisuals,
  useIsScenarioRole,
  type DisplayRoleVisuals,
} from "./scenarioRoles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: string;
  content:
    | string
    | null
    | Array<Record<string, unknown> | string>;
  tool_calls?: Array<{
    function: { name: string; arguments: string };
    id: string;
    type: string;
  }>;
  // OpenAI o-series reasoning models surface chain-of-thought here. Anthropic
  // uses `thinking`. Treat both as the same "reasoning" concept.
  reasoning_content?: string | null;
  thinking?: string | null;
  name?: string;
  tool_call_id?: string;
}

/**
 * Anthropic-style typed content blocks. A single message's `content` can be
 * a heterogenous array of text / thinking / tool_use / tool_result, all
 * mixed together. We render each block with its own dedicated UI so the
 * thinking and tool calls don't end up dumped as raw JSON in the body.
 */
export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | {
      kind: "tool_use";
      id?: string;
      name: string;
      input: unknown;
    }
  | {
      kind: "tool_result";
      toolUseId?: string;
      content: unknown;
      isError?: boolean;
    }
  | { kind: "raw"; data: unknown };

export type ConversationTurn =
  | {
      kind: "user";
      blocks: ContentBlock[];
      toolCalls: NonNullable<ChatMessage["tool_calls"]>;
      messages: ChatMessage[];
    }
  | {
      kind: "assistant";
      blocks: ContentBlock[];
      toolCalls: NonNullable<ChatMessage["tool_calls"]>;
      messages: ChatMessage[];
    }
  | {
      kind: "system";
      role: "system" | "developer";
      blocks: ContentBlock[];
      messages: ChatMessage[];
    };

export type ChatLayout = "thread" | "bubbles";
export const VIRTUALIZE_AT = 20;

/**
 * Above this turn count we collapse everything except the last turn by
 * default — short convos still benefit from showing the last couple
 * expanded; long convos drown the user in collapsed noise unless we're
 * aggressive about hiding.
 */
export const LONG_THREAD_THRESHOLD = 6;

// ---------------------------------------------------------------------------
// Detection / parsing helpers
// ---------------------------------------------------------------------------

/**
 * Heuristic: does this string look like an XML/tag-shaped payload (e.g. an
 * Anthropic-style prompt template with `<scenario>…</scenario>` blocks)?
 */
export function looksLikeXml(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t[0] !== "<") return false;
  return /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1\s*>/.test(t);
}

/**
 * Heuristic test for "this whole string is a JSON document". We only fence
 * when the entire content parses — a JSON snippet embedded in prose stays
 * as-is so the prose still renders normally.
 */
export function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return false;
  if (t[0] !== "{" && t[0] !== "[") return false;
  const last = t[t.length - 1];
  if (last !== "}" && last !== "]") return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format raw text as markdown, wrapping it in a fenced code block when the
 * content is recognisably one of: XML, a JSON document. This is what gives
 * the conversation bubbles syntax-highlighted code snippets via the
 * existing `RenderedMarkdown` → Shiki pipeline.
 */
export function asMarkdownBody(content: string): string {
  if (looksLikeXml(content)) {
    return "```xml\n" + content + "\n```";
  }
  if (looksLikeJson(content)) {
    return "```json\n" + tryPrettyJson(content) + "\n```";
  }
  return content;
}

export function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function tryParseJSON(s: string): unknown | null {
  try {
    const trimmed = s.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      (trimmed.endsWith("}") || trimmed.endsWith("]"))
    ) {
      return JSON.parse(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}

const VALID_CHAT_ROLES = new Set([
  "system",
  "user",
  "assistant",
  "tool",
  "developer",
  "function",
]);

function isOneChatMessage(item: unknown): item is ChatMessage {
  if (typeof item !== "object" || item === null) return false;
  const obj = item as Record<string, unknown>;
  if (typeof obj.role !== "string") return false;
  if (!VALID_CHAT_ROLES.has(obj.role)) return false;
  const validContent =
    obj.content === null ||
    typeof obj.content === "string" ||
    Array.isArray(obj.content);
  const hasToolCalls = Array.isArray(obj.tool_calls);
  return validContent || hasToolCalls;
}

export function isChatMessagesArray(data: unknown): data is ChatMessage[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return false;
  return data.every(isOneChatMessage);
}

/**
 * Try to coerce a parsed value into a chat message array. Handles every
 * shape we've seen in trace input/output payloads:
 *   - the array itself                  `[{role,content},...]`
 *   - a single message object           `{role,content}`
 *   - an envelope w/ `messages` field   `{messages: [...]}`
 *   - same with `input`/`history`/`output`/`data`/`value` keys
 *   - any of the above as a stringified JSON value (double-stringified)
 *   - any of the above with the inner `content` field itself a JSON string
 *     of a typed block (`'{"type":"thinking",…}'`) — those get parsed lazy
 *     by `parseContentBlocks` later, so we just keep the message.
 *
 * Returns null if the data genuinely isn't chat-shaped.
 */
export function coerceToChatMessages(data: unknown): ChatMessage[] | null {
  // Unwrap one level of stringification — some traces store the chat as a
  // JSON-encoded string field.
  if (typeof data === "string") {
    const parsed = tryParseJSON(data);
    if (parsed !== null && parsed !== data) {
      return coerceToChatMessages(parsed);
    }
    return null;
  }
  if (isChatMessagesArray(data)) return data;
  if (isOneChatMessage(data)) return [data];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const key of [
      "messages",
      "input",
      "history",
      "output",
      "data",
      "value",
      "events",
    ]) {
      const candidate = obj[key];
      if (candidate === undefined) continue;
      const result = coerceToChatMessages(candidate);
      if (result) return result;
    }
  }
  return null;
}

/**
 * Find the position of the matching closing `}` for the JSON object that
 * starts at `start`. String-literal aware so escaped quotes don't fool it.
 */
export function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\") {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function extractInlineBlocks(content: string): ContentBlock[] {
  if (!content) return [];
  const out: ContentBlock[] = [];
  let cursor = 0;
  let textBuffer = "";

  const flushText = () => {
    if (textBuffer.length === 0) return;
    const t = textBuffer.replace(/^\s+|\s+$/g, "");
    if (t.length > 0) out.push({ kind: "text", text: textBuffer });
    textBuffer = "";
  };

  while (cursor < content.length) {
    const nextBrace = content.indexOf("{", cursor);
    if (nextBrace === -1) {
      textBuffer += content.slice(cursor);
      break;
    }

    const end = findJsonObjectEnd(content, nextBrace);
    if (end === -1) {
      textBuffer += content.slice(cursor);
      break;
    }

    const slice = content.slice(nextBrace, end + 1);
    if (!slice.includes('"type":')) {
      textBuffer += content.slice(cursor, end + 1);
      cursor = end + 1;
      continue;
    }

    let consumed = false;
    try {
      const parsed = JSON.parse(slice) as Record<string, unknown>;
      if (parsed && typeof parsed.type === "string") {
        const blocks = parseContentBlocks([parsed]);
        const block = blocks[0];
        if (block && block.kind !== "raw") {
          textBuffer += content.slice(cursor, nextBrace);
          flushText();
          out.push(block);
          consumed = true;
        }
      }
    } catch {
      // not a clean JSON object — fall through and keep as text
    }

    if (!consumed) {
      textBuffer += content.slice(cursor, end + 1);
    }
    cursor = end + 1;
  }

  flushText();
  return out;
}

export function parseContentBlocks(content: ChatMessage["content"]): ContentBlock[] {
  if (content == null) return [];
  if (typeof content === "string") {
    if (content.length === 0) return [];
    const trimmed = content.trim();

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          const blocks = parseContentBlocks(parsed);
          if (
            blocks.length > 0 &&
            blocks.some((b) => b.kind !== "text" && b.kind !== "raw")
          ) {
            return blocks;
          }
        } else if (parsed && typeof parsed === "object") {
          const single = parseContentBlocks([parsed as Record<string, unknown>]);
          if (single.length > 0 && single[0]!.kind !== "raw") {
            return single;
          }
        }
      } catch {
        // fall through to inline-blocks scanner
      }
    }

    if (content.includes('"type":"')) {
      const inline = extractInlineBlocks(content);
      if (inline.some((b) => b.kind !== "text" && b.kind !== "raw")) {
        return inline;
      }
    }

    return [{ kind: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    if (content && typeof content === "object") {
      return parseContentBlocks([content as Record<string, unknown>]);
    }
    return [];
  }

  const out: ContentBlock[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.length > 0) out.push({ kind: "text", text: part });
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const obj = part as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";
    switch (type) {
      case "text": {
        const text = typeof obj.text === "string" ? obj.text : "";
        if (!text) break;
        // The `text` field may itself be a JSON-encoded typed block —
        // Claude Code traces do this: `{type:"text", text:"{\"type\":
        // \"thinking\",\"thinking\":\"…\"}"}`. Unwrap one level so the
        // proper kind reaches the renderer instead of being shown as
        // a text dump of JSON.
        const trimmed = text.trim();
        if (
          trimmed.length > 0 &&
          trimmed[0] === "{" &&
          trimmed[trimmed.length - 1] === "}" &&
          trimmed.includes('"type":"')
        ) {
          try {
            const inner = JSON.parse(trimmed) as Record<string, unknown>;
            if (
              inner &&
              typeof inner === "object" &&
              typeof inner.type === "string" &&
              inner.type !== "text"
            ) {
              const innerBlocks = parseContentBlocks([inner]);
              const first = innerBlocks[0];
              if (first && first.kind !== "raw") {
                out.push(...innerBlocks);
                break;
              }
            }
          } catch {
            // not clean JSON — fall through to a plain text block
          }
        }
        out.push({ kind: "text", text });
        break;
      }
      case "thinking":
      case "reasoning": {
        const text =
          (typeof obj.thinking === "string" && obj.thinking) ||
          (typeof obj.text === "string" && obj.text) ||
          "";
        if (text) out.push({ kind: "thinking", text });
        break;
      }
      case "tool_use": {
        out.push({
          kind: "tool_use",
          id: typeof obj.id === "string" ? obj.id : undefined,
          name: typeof obj.name === "string" ? obj.name : "tool",
          input: obj.input,
        });
        break;
      }
      case "tool_result": {
        out.push({
          kind: "tool_result",
          toolUseId:
            typeof obj.tool_use_id === "string" ? obj.tool_use_id : undefined,
          content: obj.content,
          isError: obj.is_error === true,
        });
        break;
      }
      default:
        out.push({ kind: "raw", data: obj });
    }
  }
  return out;
}

export function joinTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Pull the readable prose for a given role out of a trace `input`/`output`
 * payload. Handles every common shape:
 *   - plain string                          → returns it
 *   - single message object                 → text from its content
 *   - chat message array                    → text from the most recent
 *                                             matching role
 *   - typed-block content array on its own  → joined text blocks
 *
 * Useful for compact bubble previews where we don't want to render the
 * full block stack but still need clean text instead of raw JSON.
 */
export function extractReadableText(
  raw: string | null | undefined,
  prefer: "user" | "assistant",
): string {
  if (!raw) return "";

  // Try to parse as JSON first; the bulk of the messy shapes are JSON.
  const parsed = tryParseJSON(raw);

  // Chat array — walk backwards for the most recent matching role.
  const chat = coerceToChatMessages(parsed);
  if (chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]!;
      if (msg.role === prefer) {
        const text = joinTextBlocks(parseContentBlocks(msg.content));
        if (text.trim()) return text;
      }
    }
    // Fallback: any text from any message.
    for (let i = chat.length - 1; i >= 0; i--) {
      const text = joinTextBlocks(parseContentBlocks(chat[i]!.content));
      if (text.trim()) return text;
    }
    return "";
  }

  // Bare typed-block array (no role wrapper).
  if (Array.isArray(parsed)) {
    const blocks = parseContentBlocks(parsed as Array<Record<string, unknown> | string>);
    const text = joinTextBlocks(blocks);
    if (text.trim()) return text;
  }

  // Bare typed-block object (no role wrapper).
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const blocks = parseContentBlocks([parsed as Record<string, unknown>]);
    const text = joinTextBlocks(blocks);
    if (text.trim()) return text;
  }

  // Not chat-shaped — return the raw string.
  return raw;
}

export function getReasoning(message: ChatMessage, blocks: ContentBlock[]): string {
  if (typeof message.reasoning_content === "string" && message.reasoning_content) {
    return message.reasoning_content;
  }
  if (typeof message.thinking === "string" && message.thinking) {
    return message.thinking;
  }
  const fromBlocks = blocks
    .filter(
      (b): b is Extract<ContentBlock, { kind: "thinking" }> =>
        b.kind === "thinking",
    )
    .map((b) => b.text)
    .join("\n\n");
  return fromBlocks;
}

/**
 * Extract reasoning from a trace input/output payload.
 */
export function extractReasoningText(raw: string | null | undefined): string {
  if (!raw) return "";
  const parsed = tryParseJSON(raw);
  const chat = coerceToChatMessages(parsed);
  if (chat) {
    for (let i = chat.length - 1; i >= 0; i--) {
      const msg = chat[i]!;
      if (msg.role === "assistant") {
        const reasoning = getReasoning(msg, parseContentBlocks(msg.content));
        if (reasoning.trim()) return reasoning;
      }
    }
  }
  return "";
}

export function toolResultBodyToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (
          c &&
          typeof c === "object" &&
          "text" in c &&
          typeof (c as { text?: unknown }).text === "string"
        ) {
          return (c as { text: string }).text;
        }
        try {
          return JSON.stringify(c);
        } catch {
          return String(c);
        }
      })
      .join("\n");
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

// ---------------------------------------------------------------------------
// Turn grouping
// ---------------------------------------------------------------------------

/**
 * Group raw chat messages into logical turns. Each message stays as its
 * own turn (two consecutive user messages are two distinct beats — we
 * don't merge them just because they share a role). The one exception:
 *
 *   • Anthropic emits `tool_result` blocks as `role=user` messages — the
 *     API echoing the tool result back to continue the assistant. Those
 *     fold into the preceding assistant turn so the chain reads as one
 *     operation, not as user/assistant/user/assistant ping-pong.
 *
 * Within a single message, *all* its content blocks (thinking + text +
 * tool_use + …) render together inside that message's turn — that's the
 * shape the model emitted, and it should be obvious in the UI.
 */
export function groupMessagesIntoTurns(messages: ChatMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];

  // Fold a user-role message into the preceding assistant turn whenever
  // the message carries no actual user prose. That covers:
  //   - the standard Anthropic tool_result echo pattern (every block is
  //     a tool_result);
  //   - mislabeled traces where tool_use / thinking blocks ended up under
  //     role=user — semantically they're always assistant operations.
  // A "user" message with at least one text block is treated as a real
  // user beat regardless of any other blocks alongside it.
  const isAssistantOperationEcho = (blocks: ContentBlock[]) =>
    blocks.length > 0 && !blocks.some((b) => b.kind === "text");

  const appendToAssistant = (msg: ChatMessage, blocks: ContentBlock[]) => {
    // If the message has reasoning_content (OpenAI) or thinking (top-level)
    // that isn't already in the content blocks, prepend it now so it
    // renders as a proper ReasoningBlock in the stack.
    const reasoning = getReasoning(msg, blocks);
    if (reasoning && !blocks.some((b) => b.kind === "thinking")) {
      blocks.unshift({ kind: "thinking", text: reasoning });
    }

    const last = turns[turns.length - 1];
    if (last && last.kind === "assistant") {
      last.blocks.push(...blocks);
      if (msg.tool_calls) last.toolCalls.push(...msg.tool_calls);
      last.messages.push(msg);
    } else {
      turns.push({
        kind: "assistant",
        blocks,
        toolCalls: msg.tool_calls ? [...msg.tool_calls] : [],
        messages: [msg],
      });
    }
  };

  for (const msg of messages) {
    const blocks = parseContentBlocks(msg.content);

    if (msg.role === "system" || msg.role === "developer") {
      turns.push({
        kind: "system",
        role: msg.role,
        blocks,
        messages: [msg],
      });
      continue;
    }

    if (msg.role === "user") {
      if (isAssistantOperationEcho(blocks)) {
        // No user prose in this message — it's an assistant op echoed
        // back through the user role. Fold into the assistant chain.
        appendToAssistant(msg, blocks);
      } else {
        // Real user message. Each user message is its own turn — even if
        // the previous turn was also user (two messages in a row remain
        // two distinct beats). Within this single turn, all its blocks
        // (thinking / text / tool_use / …) render together.
        turns.push({
          kind: "user",
          blocks,
          toolCalls: msg.tool_calls ? [...msg.tool_calls] : [],
          messages: [msg],
        });
      }
      continue;
    }

    // assistant / tool / function — fold into the assistant operation chain.
    appendToAssistant(msg, blocks);
  }

  return turns;
}

export function summarizeTurn(turn: ConversationTurn): string {
  if (turn.kind === "user") {
    const text = turn.blocks
      .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
      .map((b) => b.text)
      .join(" ");
    if (text.trim()) return text.replace(/\s+/g, " ").trim().slice(0, 140);
    const tu = turn.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "tool_use" }> => b.kind === "tool_use",
    );
    if (tu) return `Tool · ${tu.name}`;
    return "—";
  }
  if (turn.kind === "system") {
    const text = turn.blocks
      .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
      .map((b) => b.text)
      .join(" ");
    return text.replace(/\s+/g, " ").trim().slice(0, 140) || "—";
  }
  const text = turn.blocks
    .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join(" ");
  if (text.trim()) return text.replace(/\s+/g, " ").trim().slice(0, 140);
  const thinking = turn.blocks.find(
    (b): b is Extract<ContentBlock, { kind: "thinking" }> => b.kind === "thinking",
  );
  if (thinking) {
    return `Thinking — ${thinking.text.replace(/\s+/g, " ").trim().slice(0, 100)}`;
  }
  const tu = turn.blocks.find(
    (b): b is Extract<ContentBlock, { kind: "tool_use" }> => b.kind === "tool_use",
  );
  if (tu) return `Tool · ${tu.name}`;
  if (turn.toolCalls.length > 0) {
    return `Tool · ${turn.toolCalls[0]!.function.name}`;
  }
  return "—";
}

// ---------------------------------------------------------------------------
// Role visuals
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<string, string> = {
  system: "SYSTEM",
  user: "USER",
  assistant: "ASSISTANT",
  tool: "TOOL",
  developer: "DEVELOPER",
};

export const ROLE_COLORS: Record<string, string> = {
  system: "fg.muted",
  user: "blue.fg",
  assistant: "green.fg",
  tool: "orange.fg",
  developer: "purple.fg",
};

export const ROLE_ICONS: Record<string, IconType> = {
  system: LuSettings,
  user: LuUser,
  assistant: LuBot,
  tool: LuWrench,
  developer: LuCode,
};

export function RoleChip({ role }: { role: string }) {
  const isScenario = useIsScenarioRole();
  const scenarioVisuals =
    isScenario && (role === "user" || role === "assistant")
      ? getDisplayRoleVisuals(role, { isScenario: true })
      : null;
  const label = scenarioVisuals?.label ?? ROLE_LABELS[role] ?? role.toUpperCase();
  // Reuse the existing role palette by keying on the *display* role under
  // scenario, so the swap matches whatever color the bubble/card around it
  // is using.
  const colorKey = scenarioVisuals?.displayRole ?? role;
  const color = ROLE_COLORS[colorKey] ?? "fg.muted";
  const RoleIcon = scenarioVisuals?.Icon ?? ROLE_ICONS[role];
  return (
    <HStack gap={1} marginBottom={1}>
      {RoleIcon && <Icon as={RoleIcon} boxSize={3} color={color} />}
      <Text
        textStyle="2xs"
        fontWeight="600"
        color={color}
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        {label}
      </Text>
    </HStack>
  );
}

// ---------------------------------------------------------------------------
// Reasoning / tool-call / tool-result components
// ---------------------------------------------------------------------------

const thinkingMirror = keyframes`
  from { background-position: 200% center; }
  to { background-position: -200% center; }
`;

/**
 * Reasoning / chain-of-thought rendered as an accordion-style block with a
 * shiny mirror highlight drifting across the text.
 */
export function ReasoningBlock({
  text,
  defaultOpen = false,
}: {
  text: string;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Box mb="2" width="full">
      <HStack
        as="button"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        gap="1.5"
        color="fg.muted"
        _hover={{ color: "fg.default" }}
        cursor="pointer"
        textStyle="xs"
        fontWeight="medium"
        py="1"
        textAlign="left"
      >
        <Icon as={isOpen ? LuChevronDown : LuChevronRight} size="3" />
        <Icon as={LuBrain} size="3" />
        <Text>Reasoned</Text>
      </HStack>

      {isOpen && (
        <Box
          pos="relative"
          pl="4"
          borderStartWidth="1px"
          borderStartColor="border.muted"
          mt="1"
          mb="2"
          fontStyle="italic"
          // The shimmer gradient - higher contrast and more colorful for visibility
          backgroundImage="linear-gradient(110deg, var(--chakra-colors-fg-muted) 35%, var(--chakra-colors-blue-fg) 45%, var(--chakra-colors-purple-fg) 50%, var(--chakra-colors-blue-fg) 55%, var(--chakra-colors-fg-muted) 65%)"
          backgroundSize="200% auto"
          backgroundClip="text"
          WebkitBackgroundClip="text"
          // Make the text itself transparent so the background shows through
          color="transparent !important"
          animation={`${thinkingMirror} 3s linear infinite`}
          // Ensure all nested markdown elements inherit the transparency and background clip
          css={{
            "& *": {
              color: "inherit !important",
              background: "inherit !important",
              backgroundClip: "inherit !important",
              WebkitBackgroundClip: "inherit !important",
            },
          }}
        >
          <RenderedMarkdown markdown={text} paddingX={0} paddingY={0} />
        </Box>
      )}
    </Box>
  );
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
    <Box paddingX={2.5} paddingY={1.5} _notFirst={{ borderTopWidth: "1px", borderTopColor: "border.muted" }}>
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

// ---------------------------------------------------------------------------
// Turn renderers
// ---------------------------------------------------------------------------

/**
 * User turn — renders every block the user message had. Pure-text turns
 * collapse into a right-aligned blue bubble (the canonical chat-user
 * look); turns with mixed blocks (text + thinking + tool_use) render
 * full-width with the same block stack as an assistant turn but with a
 * blue accent + "User" chip, so it's still obvious *which* role this turn
 * belonged to AND visible that it had thinking/tool_use/etc inside.
 */
export function UserTurnBubble({
  blocks,
  toolCalls,
  visuals,
  collapseTools = false,
}: {
  blocks: ContentBlock[];
  toolCalls: NonNullable<ChatMessage["tool_calls"]>;
  /**
   * Optional label/icon override. Used when scenario mode swaps an
   * `assistant` source-role turn into the user-side bubble so reviewers
   * see the agent under test as the trace's "user".
   */
  visuals?: DisplayRoleVisuals;
  collapseTools?: boolean;
}) {
  const HeaderIcon = visuals?.Icon ?? LuUser;
  const headerLabel = visuals?.bubbleLabel ?? "User";
  const onlyText = blocks.length > 0 && blocks.every((b) => b.kind === "text");

  // Pure-prose user message → classic chat bubble layout.
  if (onlyText) {
    const text = blocks
      .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
      .map((b) => b.text)
      .join("\n");
    return (
      <Box marginBottom={4} display="flex" justifyContent="flex-end">
        <Box
          maxWidth="calc(100% - 24px)"
          bg="blue.subtle"
          borderRadius="lg"
          borderTopRightRadius="sm"
          paddingX={3.5}
          paddingY={2.5}
        >
          <HStack gap={1.5} marginBottom={1.5}>
            <Flex
              width="16px"
              height="16px"
              borderRadius="full"
              bg="blue.muted"
              align="center"
              justify="center"
              flexShrink={0}
            >
              <Icon as={HeaderIcon} boxSize="10px" color="blue.fg" />
            </Flex>
            <Text
              textStyle="2xs"
              color="blue.fg"
              fontWeight="600"
              textTransform="uppercase"
              letterSpacing="0.06em"
            >
              {headerLabel}
            </Text>
          </HStack>
          <Box color="fg" textStyle="xs" lineHeight="1.6">
            {text ? (
              <RenderedMarkdown
                markdown={asMarkdownBody(text)}
                paddingX={0}
                paddingY={0}
              />
            ) : (
              <Text>—</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  // Mixed-content user message (or empty). Render full-width with the
  // same block stack as an assistant turn but blue-accented.
  return (
    <Box
      marginBottom={4}
      paddingLeft={4}
      borderLeftWidth="2px"
      borderLeftColor="blue.muted"
    >
      <HStack gap={1.5} marginBottom={1.5}>
        <Flex
          width="16px"
          height="16px"
          borderRadius="full"
          bg="blue.muted"
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={HeaderIcon} boxSize="10px" color="blue.fg" />
        </Flex>
        <Text
          textStyle="2xs"
          color="blue.fg"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          {headerLabel}
        </Text>
      </HStack>
      <BlockStack
        blocks={blocks}
        toolCalls={toolCalls}
        collapseTools={collapseTools}
      />
    </Box>
  );
}

/**
 * Shared "stack of typed blocks" renderer — used by both UserTurnBubble
 * (mixed user content) and AssistantTurnCard. Walks the blocks in the
 * order the model emitted them so thinking → text → tool_use → tool_result
 * reads naturally.
 */
/**
 * Re-run parsing on a text block if it visibly looks like a serialized
 * typed block JSON (`{"type":"…",…}`). Catches every upstream failure
 * mode where parseContentBlocks ended up returning text instead of the
 * proper typed block — final safety net so the user never sees raw
 * `{"type":"thinking",…}` in the rendered body.
 */
function reparseTextBlock(text: string): ContentBlock[] | null {
  if (!text || !text.includes('"type":"')) return null;
  const reparsed = parseContentBlocks(text);
  if (reparsed.some((b) => b.kind !== "text" && b.kind !== "raw")) {
    return reparsed;
  }
  return null;
}

/**
 * A pairing item — either a standalone block, or a `tool_use` already
 * matched with its `tool_result` (or marked unmatched when no result is
 * available). Used to flatten `tool_use → tool_result` walls into a
 * single grouped card per call.
 */
type StackItem =
  | { kind: "block"; block: ContentBlock }
  | {
      kind: "tool_pair";
      use: Extract<ContentBlock, { kind: "tool_use" }>;
      result: Extract<ContentBlock, { kind: "tool_result" }> | null;
    }
  | {
      kind: "orphan_result";
      result: Extract<ContentBlock, { kind: "tool_result" }>;
    };

function pairToolBlocks(blocks: ContentBlock[]): StackItem[] {
  const out: StackItem[] = [];
  const consumed = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    if (consumed.has(i)) continue;
    const b = blocks[i]!;
    if (b.kind === "tool_use") {
      // Match by id when both sides have one. Otherwise grab the next
      // unconsumed tool_result — that's the order the API emitted them.
      let resultIdx = -1;
      for (let j = i + 1; j < blocks.length; j++) {
        if (consumed.has(j)) continue;
        const cand = blocks[j]!;
        if (cand.kind !== "tool_result") continue;
        if (b.id && cand.toolUseId) {
          if (cand.toolUseId === b.id) {
            resultIdx = j;
            break;
          }
          continue;
        }
        resultIdx = j;
        break;
      }
      if (resultIdx >= 0) {
        consumed.add(resultIdx);
        out.push({
          kind: "tool_pair",
          use: b,
          result: blocks[resultIdx] as Extract<
            ContentBlock,
            { kind: "tool_result" }
          >,
        });
      } else {
        out.push({ kind: "tool_pair", use: b, result: null });
      }
      continue;
    }
    if (b.kind === "tool_result") {
      // tool_result without a preceding tool_use — render solo as its own
      // unmatched card so the data isn't silently dropped.
      out.push({ kind: "orphan_result", result: b });
      continue;
    }
    out.push({ kind: "block", block: b });
  }
  return out;
}

function BlockStack({
  blocks,
  toolCalls,
  collapseTools = false,
}: {
  blocks: ContentBlock[];
  toolCalls: NonNullable<ChatMessage["tool_calls"]>;
  collapseTools?: boolean;
}) {
  const items = useMemo(() => pairToolBlocks(blocks), [blocks]);
  const isEmpty = items.length === 0 && toolCalls.length === 0;

  const toolItemCount = useMemo(
    () =>
      items.filter((it) => it.kind === "tool_pair" || it.kind === "orphan_result")
        .length + toolCalls.length,
    [items, toolCalls],
  );
  const firstToolIdx = useMemo(
    () =>
      items.findIndex(
        (it) => it.kind === "tool_pair" || it.kind === "orphan_result",
      ),
    [items],
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  const shouldCollapseTools = collapseTools && toolItemCount > 0;

  const renderItem = (item: StackItem, i: number) => {
    if (item.kind === "tool_pair") {
      return (
        <ToolPairCard
          key={item.use.id ?? `tp-${i}`}
          name={item.use.name}
          input={item.use.input}
          id={item.use.id}
          result={
            item.result
              ? { content: item.result.content, isError: item.result.isError }
              : null
          }
        />
      );
    }
    if (item.kind === "orphan_result") {
      return (
        <ToolPairCard
          key={item.result.toolUseId ?? `or-${i}`}
          name={item.result.toolUseId ?? "tool"}
          input={undefined}
          id={item.result.toolUseId}
          result={{
            content: item.result.content,
            isError: item.result.isError,
          }}
        />
      );
    }
    const b = item.block;
    switch (b.kind) {
      case "thinking":
        return <ReasoningBlock key={`th-${i}`} text={b.text} />;
      case "text": {
        const reparsed = reparseTextBlock(b.text);
        if (reparsed) {
          return (
            <BlockStack
              key={`t-${i}`}
              blocks={reparsed}
              toolCalls={[]}
              collapseTools={collapseTools}
            />
          );
        }
        return (
          <Box key={`t-${i}`} textStyle="xs" color="fg" lineHeight="1.6">
            <RenderedMarkdown
              markdown={asMarkdownBody(b.text)}
              paddingX={0}
              paddingY={0}
            />
          </Box>
        );
      }
      case "raw":
        return (
          <Box
            key={`r-${i}`}
            as="pre"
            textStyle="2xs"
            fontFamily="mono"
            color="fg.muted"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            bg="bg.subtle"
            borderRadius="sm"
            paddingX={2.5}
            paddingY={1.5}
            margin={0}
          >
            {(() => {
              try {
                return JSON.stringify(b.data, null, 2);
              } catch {
                return String(b.data);
              }
            })()}
          </Box>
        );
      default:
        return null;
    }
  };

  const expander = shouldCollapseTools ? (
    <Box key="tool-expander">
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setToolsOpen((v) => !v)}
        paddingX={2}
        paddingY={1}
        height="auto"
        color="fg.subtle"
        _hover={{ color: "fg.muted", bg: "bg.muted" }}
      >
        <Icon
          as={toolsOpen ? LuChevronDown : LuChevronRight}
          boxSize={3}
          marginEnd={1}
        />
        <Icon as={LuWrench} boxSize={3} marginEnd={1.5} />
        <Text textStyle="xs" fontWeight="500">
          {toolsOpen
            ? `Hide ${toolItemCount === 1 ? "1 tool call" : `${toolItemCount} tool calls`}`
            : `Show ${toolItemCount === 1 ? "1 tool call" : `${toolItemCount} tool calls`}`}
        </Text>
      </Button>
    </Box>
  ) : null;

  return (
    <VStack align="stretch" gap={1.5}>
      {items.map((item, i) => {
        const isToolItem =
          item.kind === "tool_pair" || item.kind === "orphan_result";
        if (shouldCollapseTools && isToolItem) {
          if (i === firstToolIdx) {
            return (
              <Box key={`tools-${i}`}>
                {expander}
                {toolsOpen && (
                  <VStack align="stretch" gap={1.5} marginTop={1.5}>
                    {renderItem(item, i)}
                  </VStack>
                )}
              </Box>
            );
          }
          if (toolsOpen) {
            return renderItem(item, i);
          }
          return null;
        }
        return renderItem(item, i);
      })}
      {shouldCollapseTools && toolCalls.length > 0 ? (
        <>
          {firstToolIdx === -1 && expander}
          {toolsOpen &&
            toolCalls.map((tc, i) => (
              <OpenAIToolCallCard key={tc.id ?? `oai-${i}`} call={tc} />
            ))}
        </>
      ) : (
        toolCalls.map((tc, i) => (
          <OpenAIToolCallCard key={tc.id ?? `oai-${i}`} call={tc} />
        ))
      )}
      {isEmpty && (
        <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
          No content
        </Text>
      )}
    </VStack>
  );
}

export function AssistantTurnCard({
  blocks,
  toolCalls,
  visuals,
  collapseTools = false,
}: {
  blocks: ContentBlock[];
  toolCalls: NonNullable<ChatMessage["tool_calls"]>;
  /**
   * Optional label/icon override. Used when scenario mode swaps a `user`
   * source-role turn into the assistant-side card so the simulator reads
   * as the "assistant" with a flask icon.
   */
  visuals?: DisplayRoleVisuals;
  collapseTools?: boolean;
}) {
  // Operations = thinking + tool_use + tool_result (every block that isn't
  // user-facing output text). The header chip lets the user collapse them
  // away and read just the assistant's final reply, which is what they
  // usually came for.
  const operationCount = useMemo(
    () =>
      blocks.filter((b) => b.kind !== "text").length + toolCalls.length,
    [blocks, toolCalls],
  );
  const hasOutputText = useMemo(
    () => blocks.some((b) => b.kind === "text"),
    [blocks],
  );
  // Default: show everything. When the assistant is mostly operations and
  // has only a small text payload (or none), it's the user's choice when
  // to hide them.
  const [opsHidden, setOpsHidden] = useState(false);

  // When operations are hidden we still walk in chronological order, but
  // skip every non-text block. Falls back to the full list when there's
  // nothing else to show (so the empty-state stays meaningful).
  const visibleBlocks = useMemo(
    () =>
      opsHidden && hasOutputText
        ? blocks.filter((b) => b.kind === "text")
        : blocks,
    [opsHidden, hasOutputText, blocks],
  );
  const visibleToolCalls = opsHidden && hasOutputText ? [] : toolCalls;

  return (
    <Box
      mb="4"
      pl="4"
      borderStartWidth="2px"
      borderStartColor="purple.muted"
      bg="bg.panel"
      py="3"
      pr="3"
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
    >
      <HStack gap="1.5" mb="1.5">
        <Flex
          w="4"
          h="4"
          borderRadius="full"
          bg="purple.muted"
          align="center"
          justify="center"
          flexShrink={0}
        >
          <Icon as={visuals?.Icon ?? LuBot} size="2.5" color="purple.fg" />
        </Flex>
        <Text
          textStyle="2xs"
          color="purple.fg"
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
        >
          {visuals?.bubbleLabel ?? "Assistant"}
        </Text>
        {!collapseTools && operationCount > 0 && hasOutputText && (
          <>
            <Box flex="1" />
            <Text
              as="button"
              type="button"
              onClick={() => setOpsHidden((v) => !v)}
              textStyle="2xs"
              color="fg.subtle"
              fontWeight="500"
              cursor="pointer"
              _hover={{ color: "fg.muted" }}
              transition="color 0.12s ease"
            >
              {opsHidden
                ? `Show ${operationCount} ${operationCount === 1 ? "step" : "steps"}`
                : `Hide ${operationCount === 1 ? "step" : "steps"}`}
            </Text>
          </>
        )}
      </HStack>
      <BlockStack
        blocks={visibleBlocks}
        toolCalls={visibleToolCalls}
        collapseTools={collapseTools}
      />
    </Box>
  );
}

export function SystemTurnView({
  role,
  blocks,
}: {
  role: "system" | "developer";
  blocks: ContentBlock[];
}) {
  const text = blocks
    .filter((b): b is Extract<ContentBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("\n");
  return (
    <Box marginBottom={3}>
      <RoleChip role={role} />
      <Box paddingLeft={4} textStyle="xs" color="fg.muted">
        {text ? (
          <RenderedMarkdown
            markdown={asMarkdownBody(text)}
            paddingX={0}
            paddingY={0}
          />
        ) : (
          <Text>—</Text>
        )}
      </Box>
    </Box>
  );
}

export function TurnView({
  turn,
  collapseTools = false,
}: {
  turn: ConversationTurn;
  collapseTools?: boolean;
}) {
  const isScenario = useIsScenarioRole();
  if (turn.kind === "system") {
    return <SystemTurnView role={turn.role} blocks={turn.blocks} />;
  }
  // In scenario mode the source role's `displayRole` is flipped, so a
  // `user` turn renders with the assistant card and an `assistant` turn
  // renders with the user bubble. The visuals carry the swapped label
  // and icon (e.g. "Simulator" + flask icon) into the bubble's header.
  const visuals = getDisplayRoleVisuals(turn.kind, { isScenario });
  if (visuals.displayRole === "user") {
    return (
      <UserTurnBubble
        blocks={turn.blocks}
        toolCalls={turn.toolCalls}
        visuals={visuals}
        collapseTools={collapseTools}
      />
    );
  }
  return (
    <AssistantTurnCard
      blocks={turn.blocks}
      toolCalls={turn.toolCalls}
      visuals={visuals}
      collapseTools={collapseTools}
    />
  );
}

/**
 * Collapsible Gmail-style turn row. Header shows role + summary; body
 * expands to the full TurnView. Continuous thread line on the left.
 */
export function ThreadedTurnView({
  turn,
  index,
  isLast,
  defaultExpanded,
  collapseTools = false,
}: {
  turn: ConversationTurn;
  index: number;
  isLast: boolean;
  defaultExpanded: boolean;
  collapseTools?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const summary = useMemo(() => summarizeTurn(turn), [turn]);
  const isScenario = useIsScenarioRole();

  // System / developer turns aren't role-swapped — only user/assistant get
  // remapped via the scenario helper. The colour token still keys off the
  // *display* role under scenario so the chip lines up with whatever
  // bubble/card body it sits next to.
  const sourceRole: string =
    turn.kind === "user"
      ? "user"
      : turn.kind === "assistant"
        ? "assistant"
        : turn.role;
  const scenarioVisuals =
    isScenario && (turn.kind === "user" || turn.kind === "assistant")
      ? getDisplayRoleVisuals(turn.kind, { isScenario: true })
      : null;
  const colorKey = scenarioVisuals?.displayRole ?? sourceRole;
  const color = ROLE_COLORS[colorKey] ?? "fg.muted";
  const RoleIcon = scenarioVisuals?.Icon ?? ROLE_ICONS[sourceRole] ?? LuUser;
  const label =
    scenarioVisuals?.label ?? ROLE_LABELS[sourceRole] ?? sourceRole.toUpperCase();
  const colorBase = color.split(".")[0]!;

  return (
    <Box position="relative" paddingLeft={8} paddingY={1}>
      {!isLast && (
        <Box
          position="absolute"
          left="11px"
          top="32px"
          bottom={-1}
          width="1px"
          bg="border.muted"
        />
      )}
      <Flex
        position="absolute"
        left={0}
        top="6px"
        width="22px"
        height="22px"
        borderRadius="full"
        bg={`${colorBase}.subtle`}
        borderWidth="1px"
        borderColor={`${colorBase}.muted`}
        align="center"
        justify="center"
        flexShrink={0}
        zIndex={1}
      >
        <Icon as={RoleIcon} boxSize={3} color={color} />
      </Flex>

      <HStack
        as="button"
        type="button"
        onClick={() => setExpanded((v) => !v)}
        gap={2}
        paddingY={1.5}
        paddingX={2.5}
        borderRadius="md"
        cursor="pointer"
        _hover={{ bg: "bg.muted" }}
        textAlign="left"
        width="full"
        align="center"
        minHeight="34px"
      >
        <Text
          textStyle="2xs"
          color={color}
          fontWeight="600"
          textTransform="uppercase"
          letterSpacing="0.06em"
          flexShrink={0}
        >
          {label}
        </Text>
        <Text
          textStyle="xs"
          color={expanded ? "fg.muted" : "fg.default"}
          truncate
          flex={1}
          minWidth={0}
          fontStyle={expanded ? "italic" : "normal"}
        >
          {expanded ? `Turn ${index + 1}` : summary}
        </Text>
        <Icon
          as={expanded ? LuChevronDown : LuChevronRight}
          boxSize={3}
          color="fg.subtle"
          flexShrink={0}
        />
      </HStack>

      {expanded && (
        <Box paddingTop={2} paddingBottom={3}>
          <TurnView turn={turn} collapseTools={collapseTools} />
        </Box>
      )}
    </Box>
  );
}

/**
 * Virtualized list of turns. Re-measures on layout shift (expand/collapse
 * a thinking block, etc.). Use only when the turn count is high enough
 * that mounting every turn would lag — see `VIRTUALIZE_AT`.
 */
export function VirtualizedChatList({
  turns,
  maxHeightPx,
  layout,
  collapseTools = false,
}: {
  turns: ConversationTurn[];
  maxHeightPx: number;
  layout: ChatLayout;
  collapseTools?: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: turns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 3,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <Box
      ref={parentRef}
      maxHeight={`${maxHeightPx}px`}
      overflow="auto"
      paddingX={3}
      paddingY={3}
      css={{
        "&::-webkit-scrollbar": { width: "4px" },
        "&::-webkit-scrollbar-thumb": {
          borderRadius: "4px",
          background: "var(--chakra-colors-border-muted)",
        },
        "&::-webkit-scrollbar-track": { background: "transparent" },
      }}
    >
      <Box
        height={`${virtualizer.getTotalSize()}px`}
        width="full"
        position="relative"
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const i = virtualRow.index;
          const turn = turns[i]!;
          // For long conversations, default to only the last turn expanded —
          // expanding the last 2 (or all of them on shorter convos) buries
          // the user in noise. Tuned at the same threshold as virtualization.
          const isLong = turns.length > LONG_THREAD_THRESHOLD;
          const defaultExpanded = isLong
            ? i === turns.length - 1
            : i >= turns.length - 2;
          return (
            <Box
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={i}
              position="absolute"
              top={0}
              left={0}
              width="full"
              transform={`translateY(${virtualRow.start}px)`}
            >
              {layout === "thread" ? (
                <ThreadedTurnView
                  turn={turn}
                  index={i}
                  isLast={i === turns.length - 1}
                  defaultExpanded={defaultExpanded}
                  collapseTools={collapseTools}
                />
              ) : (
                <TurnView turn={turn} collapseTools={collapseTools} />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * Render a list of content blocks as a vertical stack — used as the
 * fallback for plain-string content that has inline `{"type":…}` JSON
 * lines but no chat-array wrapper around them.
 */
export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  if (blocks.length === 0) return null;
  return <BlockStack blocks={blocks} toolCalls={[]} />;
}
