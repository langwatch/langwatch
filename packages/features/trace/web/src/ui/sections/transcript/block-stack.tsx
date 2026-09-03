import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuWrench } from "react-icons/lu";
import { splitLeadingContextBlocks } from "@langwatch/coding-agent-contract";
import { RenderedMarkdown } from "../../blocks/markdown/rendered-markdown";
import { asMarkdownBody, withBlockKeys } from "../../../behavior/transcript/parsing";
import { ContextDisclosure } from "../../blocks/transcript/context-disclosure";
import { itemBlockKey, pairToolBlocks, type StackItem } from "../../../model/transcript/block-stack-items";
import { reparseTextBlock } from "../../../behavior/transcript/reparse-text-block";
import { ReasoningBlock } from "../../blocks/transcript/reasoning-block";
import { OpenAIToolCallCard, ToolPairCard } from "./tool-blocks";
import type { ChatMessage, ContentBlock } from "../../../model/transcript/types";
import { useTranscriptRenderPorts } from "../../elements/transcript-render-ports";

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
      items.filter((it) => it.kind === "tool_pair" || it.kind === "orphan_result").length +
      toolCalls.length,
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
      <HStack key={blockKey} align="flex-start" gap={1} width="full" className="msg-block">
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
            item.result ? { content: item.result.content, isError: item.result.isError } : null
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
                <RenderedMarkdown markdown={asMarkdownBody(body)} paddingX={0} paddingY={0} />
              </Box>
            </VStack>
          );
        }
        return (
          <Box key={b.blockKey} textStyle="xs" color="fg" lineHeight="1.6">
            <RenderedMarkdown markdown={asMarkdownBody(b.text)} paddingX={0} paddingY={0} />
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
            toolCalls.map((tc, i) => <OpenAIToolCallCard key={tc.id ?? `oai-${i}`} call={tc} />)}
        </>
      ) : (
        toolCalls.map((tc, i) => <OpenAIToolCallCard key={tc.id ?? `oai-${i}`} call={tc} />)
      )}
      {isEmpty && (
        <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
          No content
        </Text>
      )}
    </VStack>
  );
}

export { pairToolBlocks } from "../../../model/transcript/block-stack-items";
export { reparseTextBlock } from "../../../behavior/transcript/reparse-text-block";
