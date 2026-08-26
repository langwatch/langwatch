import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuFileText, LuWrench } from "react-icons/lu";
import { splitLeadingContextBlocks } from "@langwatch/coding-agent-contract";
import { RenderedMarkdown } from "../markdown/rendered-markdown";
import { asMarkdownBody, parseContentBlocks, withBlockKeys } from "./parsing";
import { ReasoningBlock } from "./reasoning-block";
import { OpenAIToolCallCard, ToolPairCard } from "./tool-blocks";
import type { ChatMessage, ContentBlock, KeyedContentBlock } from "./types";
import { useTranscriptRenderPorts } from "../transcript-render-ports";

/**
 * Re-run parsing on a text block if it visibly looks like a serialized
 * typed block JSON (`{"type":"…",…}`). Catches every upstream failure
 * mode where parseContentBlocks ended up returning text instead of the
 * proper typed block — final safety net so the user never sees raw
 * `{"type":"thinking",…}` in the rendered body.
 */
export function reparseTextBlock(text: string): ContentBlock[] | null {
  if (!text?.includes('"type":"')) return null;
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
type KeyedBlock<K extends ContentBlock["kind"]> = Extract<KeyedContentBlock, { kind: K }>;

type StackItem =
  | { kind: "block"; block: KeyedContentBlock }
  | {
      kind: "tool_pair";
      use: KeyedBlock<"tool_use">;
      result: KeyedBlock<"tool_result"> | null;
    }
  | {
      kind: "orphan_result";
      result: KeyedBlock<"tool_result">;
    };

/**
 * The key a comment on this item is stored against. A tool call and the result
 * it was paired with read as one card, so the call's key is what identifies it.
 */
function itemBlockKey(item: StackItem): string {
  if (item.kind === "tool_pair") return item.use.blockKey;
  if (item.kind === "orphan_result") return item.result.blockKey;
  return item.block.blockKey;
}

export function pairToolBlocks(blocks: KeyedContentBlock[]): StackItem[] {
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
      const result = resultIdx >= 0 ? blocks[resultIdx] : undefined;
      if (result?.kind === "tool_result") {
        consumed.add(resultIdx);
        out.push({
          kind: "tool_pair",
          use: b,
          result,
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

export interface BlockStackProps {
  blocks: ContentBlock[];
  toolCalls: NonNullable<ChatMessage["tool_calls"]>;
  collapseTools?: boolean;
  /** Namespaces nested block identities for stable comment anchors. */
  keyPrefix?: string;
}

export function BlockStack({
  blocks,
  toolCalls,
  collapseTools = false,
  keyPrefix = "",
}: BlockStackProps) {
  const { renderCommentAction, renderMediaPart } = useTranscriptRenderPorts();
  const items = useMemo(
    () => pairToolBlocks(withBlockKeys(blocks, keyPrefix)),
    [blocks, keyPrefix],
  );
  const isEmpty = items.length === 0 && toolCalls.length === 0;

  const toolItemCount = useMemo(
    () =>
      items.filter((it) => it.kind === "tool_pair" || it.kind === "orphan_result")
        .length + toolCalls.length,
    [items, toolCalls],
  );
  const firstToolIdx = useMemo(
    () => items.findIndex((it) => it.kind === "tool_pair" || it.kind === "orphan_result"),
    [items],
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  const shouldCollapseTools = collapseTools && toolItemCount > 0;

  const renderItem = (item: StackItem) => {
    const blockKey = itemBlockKey(item);
    return renderCommentAction ? (
      <HStack
        key={blockKey}
        align="flex-start"
        gap={1}
        width="full"
        className="msg-block"
      >
        <Box flex={1} minWidth={0}>
          {renderBlockContent(item)}
        </Box>
        {renderCommentAction(blockKey)}
      </HStack>
    ) : (
      renderBlockContent(item)
    );
  };

  const renderBlockContent = (item: StackItem) => {
    if (item.kind === "tool_pair") {
      return (
        <ToolPairCard
          key={item.use.blockKey}
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
          key={item.result.blockKey}
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
        return <ReasoningBlock key={b.blockKey} text={b.text} />;
      case "text": {
        const reparsed = reparseTextBlock(b.text);
        if (reparsed) {
          return (
            <BlockStack
              key={b.blockKey}
              blocks={reparsed}
              toolCalls={[]}
              collapseTools={collapseTools}
              keyPrefix={b.blockKey}
            />
          );
        }
        // Collapse Claude-Code-style prepended context (<system-reminder>,
        // MCP instructions, skills list) behind a disclosure when real prose
        // follows it, so the human text reads first.
        const { context, body } = splitLeadingContextBlocks(b.text);
        if (context && body.trim()) {
          return (
            <VStack key={b.blockKey} align="stretch" gap={1.5}>
              <ContextDisclosure context={context} />
              <Box textStyle="xs" color="fg" lineHeight="1.6">
                <RenderedMarkdown
                  markdown={asMarkdownBody(body)}
                  paddingX={0}
                  paddingY={0}
                />
              </Box>
            </VStack>
          );
        }
        return (
          <Box key={b.blockKey} textStyle="xs" color="fg" lineHeight="1.6">
            <RenderedMarkdown
              markdown={asMarkdownBody(b.text)}
              paddingX={0}
              paddingY={0}
            />
          </Box>
        );
      }
      case "media":
        return renderMediaPart ? renderMediaPart(b.part) : null;
      case "raw":
        return (
          <Box
            key={b.blockKey}
            as="pre"
            textStyle="2xs"
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
        <Icon as={toolsOpen ? LuChevronDown : LuChevronRight} boxSize={3} marginEnd={1} />
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
        const isToolItem = item.kind === "tool_pair" || item.kind === "orphan_result";
        if (shouldCollapseTools && isToolItem) {
          if (i === firstToolIdx) {
            return (
              <Box key={`tools-${i}`}>
                {expander}
                {toolsOpen && (
                  <VStack align="stretch" gap={1.5} marginTop={1.5}>
                    {renderItem(item)}
                  </VStack>
                )}
              </Box>
            );
          }
          if (toolsOpen) {
            return renderItem(item);
          }
          return null;
        }
        return renderItem(item);
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

/**
 * Collapsible disclosure for the prepended context (system-reminder, MCP
 * instructions, skills list) that agents stack above the human message.
 * Collapsed by default so the actual conversation reads first; a one-line
 * snippet hints at what is hidden, and expanding shows the full block.
 */
function ContextDisclosure({ context }: { context: string }) {
  const [open, setOpen] = useState(false);
  const snippet = useMemo(() => {
    const flat = context.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
  }, [context]);

  return (
    <Box>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        paddingX={2}
        paddingY={1}
        height="auto"
        color="fg.subtle"
        _hover={{ color: "fg.muted", bg: "bg.muted" }}
      >
        <Icon as={open ? LuChevronDown : LuChevronRight} boxSize={3} marginEnd={1} />
        <Icon as={LuFileText} boxSize={3} marginEnd={1.5} />
        <Text textStyle="xs" fontWeight="500">
          {open ? "Hide additional context" : "Hidden additional context"}
        </Text>
      </Button>
      {!open && (
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono" paddingX={2} truncate>
          {snippet}
        </Text>
      )}
      {open && (
        <Box textStyle="xs" color="fg.muted" lineHeight="1.6" paddingTop={1}>
          <RenderedMarkdown
            markdown={asMarkdownBody(context)}
            paddingX={0}
            paddingY={0}
          />
        </Box>
      )}
    </Box>
  );
}
