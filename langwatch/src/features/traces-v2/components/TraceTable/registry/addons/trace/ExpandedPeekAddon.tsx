import {
  Box,
  Circle,
  Flex,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { useTraceSpanTree } from "../../../../../hooks/useTraceSpanTree";
import type {
  TraceEvalResult,
  TraceListItem,
} from "../../../../../types/trace";
import {
  abbreviateModel,
  formatDuration,
  SPAN_TYPE_COLORS,
} from "../../../../../utils/formatters";
import { Td, Tr } from "../../../TablePrimitives";
import { evalChipColor, formatEvalScore } from "../../sharedChips";
import type { AddonDef } from "../../types";

const PEEK_INDENT_PX = 16;
const PEEK_SPAN_TYPE_ICONS: Record<string, string> = {
  llm: "\u25C8",
  tool: "\u2699",
  agent: "\u25CE",
  rag: "\u229B",
  guardrail: "\u25C9",
  evaluation: "\u25C7",
  chain: "\u25CB",
  span: "\u25CB",
  module: "\u25CB",
  workflow: "\u25CB",
};

interface PeekTreeNode {
  span: SpanTreeNode;
  children: PeekTreeNode[];
  depth: number;
}

function buildPeekTree(spans: SpanTreeNode[]): PeekTreeNode[] {
  const childrenMap = new Map<string | null, SpanTreeNode[]>();
  const byId = new Set(spans.map((s) => s.spanId));

  for (const span of spans) {
    const parentExists = span.parentSpanId
      ? byId.has(span.parentSpanId)
      : true;
    const key = parentExists ? span.parentSpanId : null;
    const list = childrenMap.get(key) ?? [];
    list.push(span);
    childrenMap.set(key, list);
  }

  function build(parentId: string | null, depth: number): PeekTreeNode[] {
    const children = childrenMap.get(parentId) ?? [];
    return [...children]
      .sort((a, b) => a.startTimeMs - b.startTimeMs)
      .map((span) => ({
        span,
        children: build(span.spanId, depth + 1),
        depth,
      }));
  }

  return build(null, 0);
}

function flattenPeekTree(nodes: PeekTreeNode[]): PeekTreeNode[] {
  const result: PeekTreeNode[] = [];
  function walk(list: PeekTreeNode[]) {
    for (const node of list) {
      result.push(node);
      walk(node.children);
    }
  }
  walk(nodes);
  return result;
}

const InlinePeekContent: React.FC<{ trace: TraceListItem }> = ({ trace }) => {
  const { data: spans, isLoading } = useTraceSpanTree(trace.traceId);

  const flatSpans = useMemo(() => {
    if (!spans || spans.length === 0) return [];
    return flattenPeekTree(buildPeekTree(spans));
  }, [spans]);

  const traceRange = useMemo(() => {
    if (!spans || spans.length === 0) return { start: 0, duration: 1 };
    const start = Math.min(...spans.map((s) => s.startTimeMs));
    const end = Math.max(...spans.map((s) => s.endTimeMs));
    return { start, duration: Math.max(end - start, 1) };
  }, [spans]);

  return (
    <VStack
      align="stretch"
      gap={0}
      paddingY={2}
      paddingLeft="40px"
      paddingRight={4}
      css={{
        animation: "peekSlideDown 0.15s ease-out",
        "@keyframes peekSlideDown": {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      }}
    >
      {isLoading ? (
        <PeekSkeleton />
      ) : (
        <VStack align="stretch" gap={0}>
          {flatSpans.map((node) => (
            <PeekSpanRow
              key={node.span.spanId}
              node={node}
              traceStart={traceRange.start}
              traceDuration={traceRange.duration}
            />
          ))}

          {trace.error && (
            <HStack
              gap={2}
              padding={2}
              marginTop={2}
              borderRadius="sm"
              bg="red.subtle"
              align="start"
            >
              <Circle size="6px" bg="red.solid" flexShrink={0} marginTop="4px" />
              <VStack align="start" gap={0} minWidth={0}>
                {trace.errorSpanName && (
                  <Text textStyle="2xs" color="red.fg" fontWeight="medium">
                    {trace.errorSpanName}
                  </Text>
                )}
                <Text textStyle="xs" color="red.fg" lineClamp={2}>
                  {trace.error}
                </Text>
              </VStack>
            </HStack>
          )}

          {trace.evaluations.length > 0 && (
            <HStack gap={1.5} flexWrap="wrap" marginTop={2}>
              {trace.evaluations.map((ev, i) => (
                <PeekEvalChip key={`${ev.evaluatorId}-${i}`} eval_={ev} />
              ))}
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
};

const PeekSkeleton: React.FC = () => (
  <VStack align="stretch" gap="6px" paddingY={1}>
    {[
      { indent: 0, name: "62%" },
      { indent: 1, name: "48%" },
      { indent: 2, name: "55%" },
      { indent: 1, name: "40%" },
    ].map((row, i) => (
      <Flex
        // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders
        key={`peek-skel-${i}`}
        align="center"
        height="26px"
        paddingLeft={`${row.indent * PEEK_INDENT_PX}px`}
        gap={2}
        css={{ animationDelay: `${i * 70}ms` }}
        opacity={0.55}
      >
        <HStack gap={1} flexShrink={0} minWidth="180px" maxWidth="280px">
          <Skeleton height="6px" width="6px" borderRadius="full" />
          <Skeleton height="8px" width={row.name} borderRadius="full" />
        </HStack>
        <Box flex={1} height="6px" borderRadius="sm" bg="fg.subtle/8" />
        <Skeleton
          height="8px"
          width="36px"
          borderRadius="full"
          flexShrink={0}
        />
      </Flex>
    ))}
  </VStack>
);

const PeekSpanRow: React.FC<{
  node: PeekTreeNode;
  traceStart: number;
  traceDuration: number;
}> = ({ node, traceStart, traceDuration }) => {
  const { span, depth } = node;
  const color =
    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  const icon = PEEK_SPAN_TYPE_ICONS[span.type ?? "span"] ?? "\u25CB";
  const isError = span.status === "error";

  const leftPct = ((span.startTimeMs - traceStart) / traceDuration) * 100;
  const widthPct = Math.max((span.durationMs / traceDuration) * 100, 0.5);

  return (
    <Flex
      align="center"
      height="22px"
      paddingLeft={`${depth * PEEK_INDENT_PX}px`}
      gap={2}
      _hover={{ bg: "fg.subtle/5" }}
      borderRadius="xs"
    >
      <HStack gap={1} flexShrink={0} minWidth="180px" maxWidth="280px">
        <Text
          textStyle="2xs"
          color={isError ? "red.fg" : color}
          lineHeight={1}
          flexShrink={0}
        >
          {icon}
        </Text>
        <Text
          textStyle="2xs"
          fontFamily="mono"
          color={isError ? "red.fg" : "fg"}
          truncate
        >
          {span.name}
        </Text>
        {span.model && (
          <Text textStyle="2xs" color="fg.subtle" truncate flexShrink={1}>
            {abbreviateModel(span.model)}
          </Text>
        )}
      </HStack>

      <Box
        flex={1}
        height="8px"
        position="relative"
        borderRadius="sm"
        bg="fg.subtle/5"
      >
        <Box
          position="absolute"
          left={`${leftPct}%`}
          width={`${widthPct}%`}
          minWidth="2px"
          height="full"
          borderRadius="sm"
          bg={isError ? "red.solid" : color}
          opacity={0.7}
        />
      </Box>

      <Text
        textStyle="2xs"
        fontFamily="mono"
        color="fg.muted"
        flexShrink={0}
        width="52px"
        textAlign="right"
      >
        {span.durationMs === 0 ? "<1ms" : formatDuration(span.durationMs)}
      </Text>
    </Flex>
  );
};

const PeekEvalChip: React.FC<{ eval_: TraceEvalResult }> = ({ eval_ }) => {
  const color = evalChipColor(eval_);
  const scoreText = formatEvalScore(eval_);
  const displayName = eval_.evaluatorName ?? eval_.evaluatorId;

  return (
    <HStack
      gap={1.5}
      paddingX={2}
      paddingY={0.5}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border"
      bg="bg.panel"
    >
      <Circle size="6px" bg={color} flexShrink={0} />
      <Text
        textStyle="2xs"
        fontWeight="medium"
        color="fg"
        truncate
        maxWidth="100px"
      >
        {displayName}
      </Text>
      {scoreText && (
        <Text textStyle="2xs" fontWeight="semibold" color="fg.muted">
          {scoreText}
        </Text>
      )}
      {eval_.passed != null && eval_.score == null && (
        <Text
          textStyle="2xs"
          fontWeight="semibold"
          color={eval_.passed ? "green.fg" : "red.fg"}
        >
          {eval_.passed ? "Pass" : "Fail"}
        </Text>
      )}
    </HStack>
  );
};

export const ExpandedPeekAddon: AddonDef<TraceListItem> = {
  id: "expanded-peek",
  label: "Span tree (expanded)",
  shouldRender: ({ isExpanded }) => isExpanded,
  render: ({ row, colSpan, style }) => (
    <Tr borderBottomWidth="1px" borderBottomColor="border.muted">
      <Td
        bg={style.bg}
        colSpan={colSpan}
        padding="0"
        borderLeftWidth="2px"
        borderLeftColor="blue.fg"
      >
        <InlinePeekContent trace={row} />
      </Td>
    </Tr>
  ),
};
