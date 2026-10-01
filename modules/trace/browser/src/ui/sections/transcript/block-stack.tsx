import { splitLeadingContextBlocks } from "@langwatch/coding-agent-contract";
import { Box, Button, HStack, Icon, Text, VStack } from "@langwatch/design-system/primitives";
import {
  asMarkdownBody,
  type ChatMessage,
  type ContentBlock,
  withBlockKeys,
} from "@langwatch/trace-contract/transcript";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight, LuWrench } from "react-icons/lu";

import {
  itemBlockKey,
  pairToolBlocks,
  type StackItem,
} from "../../../model/transcript/block-stack-items.ts";
import { reparseTextBlock } from "../../../model/transcript/reparse-text-block.ts";
import { RenderedMarkdown } from "../../blocks/markdown/rendered-markdown.tsx";
import { ContextDisclosure } from "../../blocks/transcript/context-disclosure.tsx";
import { ReasoningBlock } from "../../blocks/transcript/reasoning-block.tsx";
import { useTranscriptRenderPorts } from "../../elements/transcript-render-ports.tsx";
import { OpenAIToolCallCard, ToolPairCard } from "./tool-blocks.tsx";

export interface BlockStackProps {
  blocks: ContentBlock[];
  toolCalls: NonNullable<ChatMessage["tool_calls"]>;
  collapseTools?: boolean;
  /** Namespaces nested block identities for stable comment anchors. */
  keyPrefix?: string;
}

const isToolItem = (item: StackItem) => item.kind === "tool_pair" || item.kind === "orphan_result";

export function BlockStack({
  blocks,
  toolCalls,
  collapseTools = false,
  keyPrefix = "",
}: BlockStackProps) {
  const items = useMemo(
    () => pairToolBlocks(withBlockKeys(blocks, keyPrefix)),
    [blocks, keyPrefix],
  );
  const toolItemCount = useMemo(
    () => items.filter(isToolItem).length + toolCalls.length,
    [items, toolCalls],
  );
  const firstToolIdx = useMemo(() => items.findIndex(isToolItem), [items]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const shouldCollapseTools = collapseTools && toolItemCount > 0;

  const expander = shouldCollapseTools ? (
    <ToolsExpander
      key="tool-expander"
      open={toolsOpen}
      count={toolItemCount}
      onToggle={() => setToolsOpen((v) => !v)}
    />
  ) : null;
  const row = (item: StackItem) => (
    <StackItemRow key={itemBlockKey(item)} item={item} collapseTools={collapseTools} />
  );

  // Collapsed tools fold behind one expander, placed where the first tool was.
  const renderItem = (item: StackItem, i: number) => {
    if (!shouldCollapseTools || !isToolItem(item)) return row(item);
    if (i !== firstToolIdx) return toolsOpen ? row(item) : null;
    return (
      <Box key={`tools-${i}`}>
        {expander}
        {toolsOpen && (
          <VStack align="stretch" gap={1.5} marginTop={1.5}>
            {row(item)}
          </VStack>
        )}
      </Box>
    );
  };
  const callCards = toolCalls.map((tc, i) => (
    <OpenAIToolCallCard key={tc.id ?? `oai-${i}`} call={tc} />
  ));
  const foldsCalls = shouldCollapseTools && toolCalls.length > 0;

  return (
    <VStack align="stretch" gap={1.5}>
      {items.map(renderItem)}
      {foldsCalls && firstToolIdx === -1 && expander}
      {(!foldsCalls || toolsOpen) && callCards}
      {items.length === 0 && toolCalls.length === 0 && (
        <Text textStyle="xs" color="fg.subtle" fontStyle="italic">
          No content
        </Text>
      )}
    </VStack>
  );
}

function ToolsExpander({
  open,
  count,
  onToggle,
}: {
  open: boolean;
  count: number;
  onToggle: () => void;
}) {
  const calls = count === 1 ? "1 tool call" : `${count} tool calls`;
  return (
    <Box>
      <Button
        size="xs"
        variant="ghost"
        onClick={onToggle}
        paddingX={2}
        paddingY={1}
        height="auto"
        color="fg.subtle"
        _hover={{ color: "fg.muted", bg: "bg.muted" }}
      >
        <Icon as={open ? LuChevronDown : LuChevronRight} boxSize={3} marginEnd={1} />
        <Icon as={LuWrench} boxSize={3} marginEnd={1.5} />
        <Text textStyle="xs" fontWeight="500">
          {open ? `Hide ${calls}` : `Show ${calls}`}
        </Text>
      </Button>
    </Box>
  );
}

/** One item, with the comment action beside it when the host offers one. */
function StackItemRow({ item, collapseTools }: { item: StackItem; collapseTools: boolean }) {
  const { renderCommentAction } = useTranscriptRenderPorts();
  const content = <StackItemContent item={item} collapseTools={collapseTools} />;
  if (!renderCommentAction) return content;
  return (
    <HStack align="flex-start" gap={1} width="full" className="msg-block">
      <Box flex={1} minWidth={0}>
        {content}
      </Box>
      {renderCommentAction(itemBlockKey(item))}
    </HStack>
  );
}

function StackItemContent({ item, collapseTools }: { item: StackItem; collapseTools: boolean }) {
  if (item.kind === "tool_pair") {
    return (
      <ToolPairCard
        name={item.use.name}
        input={item.use.input}
        id={item.use.id}
        result={item.result ? { content: item.result.content, isError: item.result.isError } : null}
      />
    );
  }
  if (item.kind === "orphan_result") {
    return (
      <ToolPairCard
        name={item.result.toolUseId ?? "tool"}
        input={undefined}
        id={item.result.toolUseId}
        result={{ content: item.result.content, isError: item.result.isError }}
      />
    );
  }
  return <BlockContent block={item.block} collapseTools={collapseTools} />;
}

type KeyedBlock = Extract<StackItem, { kind: "block" }>["block"];

function BlockContent({ block, collapseTools }: { block: KeyedBlock; collapseTools: boolean }) {
  const { renderMediaPart } = useTranscriptRenderPorts();
  switch (block.kind) {
    case "thinking":
      return <ReasoningBlock text={block.text} />;
    case "text":
      return (
        <TextBlock text={block.text} blockKey={block.blockKey} collapseTools={collapseTools} />
      );
    case "media":
      return renderMediaPart ? renderMediaPart(block.part) : null;
    case "raw":
      return <RawBlock data={block.data} />;
    default:
      return null;
  }
}

function Prose({ markdown }: { markdown: string }) {
  return (
    <Box textStyle="xs" color="fg" lineHeight="1.6">
      <RenderedMarkdown markdown={asMarkdownBody(markdown)} paddingX={0} paddingY={0} />
    </Box>
  );
}

/**
 * A text block: re-parsed into blocks when it carries serialized ones, and with
 * prepended agent context (system reminders, instructions) behind a disclosure
 * when real prose follows it, so the human text reads first.
 */
function TextBlock({
  text,
  blockKey,
  collapseTools,
}: {
  text: string;
  blockKey: string;
  collapseTools: boolean;
}) {
  const reparsed = reparseTextBlock(text);
  if (reparsed) {
    return (
      <BlockStack
        blocks={reparsed}
        toolCalls={[]}
        collapseTools={collapseTools}
        keyPrefix={blockKey}
      />
    );
  }
  const { context, body } = splitLeadingContextBlocks(text);
  if (!context || !body.trim()) return <Prose markdown={text} />;
  return (
    <VStack align="stretch" gap={1.5}>
      <ContextDisclosure context={context} />
      <Prose markdown={body} />
    </VStack>
  );
}

function stringifyRaw(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function RawBlock({ data }: { data: unknown }) {
  return (
    <Box
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
      {stringifyRaw(data)}
    </Box>
  );
}
