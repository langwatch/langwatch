import { Box, Button, Icon, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuWrench } from "react-icons/lu";
import { RenderedMarkdown } from "../markdownView";
import { asMarkdownBody, parseContentBlocks } from "./parsing";
import { ReasoningBlock } from "./ReasoningBlock";
import { OpenAIToolCallCard, ToolPairCard } from "./ToolBlocks";
import type { ChatMessage, ContentBlock } from "./types";

/**
 * Re-run parsing on a text block if it visibly looks like a serialized
 * typed block JSON (`{"type":"…",…}`). Catches every upstream failure
 * mode where parseContentBlocks ended up returning text instead of the
 * proper typed block — final safety net so the user never sees raw
 * `{"type":"thinking",…}` in the rendered body.
 */
export function reparseTextBlock(text: string): ContentBlock[] | null {
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

export function pairToolBlocks(blocks: ContentBlock[]): StackItem[] {
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

export function BlockStack({
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
      items.filter(
        (it) => it.kind === "tool_pair" || it.kind === "orphan_result",
      ).length + toolCalls.length,
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
