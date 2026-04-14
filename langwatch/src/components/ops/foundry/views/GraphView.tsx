import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type OnNodeClick,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Box, HStack, Text } from "@chakra-ui/react";
import { useColorMode } from "~/components/ui/color-mode";
import { useTraceStore } from "../traceStore";
import {
  SPAN_TYPE_ICONS,
  SPAN_TYPE_COLORS,
  type SpanConfig,
} from "../types";

interface SpanNodeData {
  label: string;
  type: string;
  durationMs: number;
  status: string;
  spanId: string;
  isSelected: boolean;
  [key: string]: unknown;
}

function SpanNode({ data }: { data: SpanNodeData }) {
  const color =
    SPAN_TYPE_COLORS[data.type as keyof typeof SPAN_TYPE_COLORS] ?? "gray.400";

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: "var(--chakra-colors-border)",
          width: 8,
          height: 8,
          border: "1px solid var(--chakra-colors-border)",
        }}
      />
      <Box
        borderRadius="lg"
        borderWidth="1px"
        borderColor={
          data.isSelected
            ? "orange.400"
            : data.status === "error"
              ? "red.600"
              : "border"
        }
        bg={
          data.isSelected
            ? "orange.subtle"
            : data.status === "error"
              ? "red.subtle"
              : "bg.panel"
        }
        paddingX={3}
        paddingY={2}
        minWidth="140px"
        boxShadow="sm"
      >
        <HStack gap={1.5}>
          <Text textStyle="sm">
            {SPAN_TYPE_ICONS[data.type as keyof typeof SPAN_TYPE_ICONS] ?? "·"}
          </Text>
          <Text textStyle="xs" fontWeight="medium" truncate maxWidth="120px">
            {data.label}
          </Text>
        </HStack>
        <HStack gap={2} marginTop={1}>
          <Text textStyle="xs" color={color} textTransform="uppercase">
            {data.type}
          </Text>
          <Text textStyle="xs" color="fg.muted">
            {data.durationMs}ms
          </Text>
        </HStack>
      </Box>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: "var(--chakra-colors-border)",
          width: 8,
          height: 8,
          border: "1px solid var(--chakra-colors-border)",
        }}
      />
    </>
  );
}

const nodeTypes: NodeTypes = {
  spanNode: SpanNode,
};

function buildNodesAndEdges(
  spans: SpanConfig[],
  selectedId: string | null,
  parentId: string | null = null,
  x = 0,
  y = 0,
): { nodes: Node<SpanNodeData>[]; edges: Edge[]; width: number } {
  const nodes: Node<SpanNodeData>[] = [];
  const edges: Edge[] = [];
  const nodeGap = 180;
  const levelGap = 100;
  let currentX = x;

  for (const span of spans) {
    const childResult = buildNodesAndEdges(
      span.children,
      selectedId,
      span.id,
      currentX,
      y + levelGap,
    );

    const childWidth = Math.max(childResult.width, nodeGap);
    const nodeX = currentX + childWidth / 2 - nodeGap / 2;

    nodes.push({
      id: span.id,
      type: "spanNode",
      position: { x: nodeX, y },
      data: {
        label: span.name,
        type: span.type,
        durationMs: span.durationMs,
        status: span.status,
        spanId: span.id,
        isSelected: selectedId === span.id,
      },
    });

    if (parentId) {
      edges.push({
        id: `${parentId}-${span.id}`,
        source: parentId,
        target: span.id,
        style: { stroke: "var(--chakra-colors-border)" },
      });
    }

    nodes.push(...childResult.nodes);
    edges.push(...childResult.edges);
    currentX += childWidth;
  }

  return { nodes, edges, width: Math.max(currentX - x, 0) };
}

export function GraphView() {
  const spans = useTraceStore((s) => s.trace.spans);
  const selectedSpanId = useTraceStore((s) => s.selectedSpanId);
  const selectSpan = useTraceStore((s) => s.selectSpan);
  const colorMode = useColorMode();

  const { nodes, edges } = useMemo(
    () => buildNodesAndEdges(spans, selectedSpanId),
    [spans, selectedSpanId],
  );

  const onNodeClick: OnNodeClick<Node<SpanNodeData>> = useCallback(
    (_event, node) => {
      selectSpan(node.data.spanId);
    },
    [selectSpan],
  );

  return (
    <Box
      height="full"
      width="full"
      className={colorMode.colorMode === "dark" ? "dark" : ""}
      css={{
        "& .react-flow__controls": {
          background: "var(--chakra-colors-bg-panel)",
          border: "1px solid var(--chakra-colors-border)",
          borderRadius: "8px",
          boxShadow: "none",
        },
        "& .react-flow__controls-button": {
          background: "var(--chakra-colors-bg-panel)",
          borderColor: "var(--chakra-colors-border)",
          fill: "var(--chakra-colors-fg-muted)",
          "&:hover": {
            background: "var(--chakra-colors-bg-muted)",
          },
        },
        "& .react-flow__edge-path": {
          stroke: "var(--chakra-colors-border)",
        },
        "& .react-flow__background pattern line": {
          stroke: "var(--chakra-colors-border)",
        },
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        colorMode={colorMode.colorMode === "dark" ? "dark" : "light"}
        style={{ background: "var(--chakra-colors-bg-subtle)" }}
      >
        <Background color="var(--chakra-colors-border)" gap={20} />
        <Controls />
      </ReactFlow>
    </Box>
  );
}
