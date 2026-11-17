import { formatCost, formatDuration } from "@langwatch/design-system/display-formatters";
import { Badge, Box, Flex, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { AgentCallGraph, AgentCallGraphEdge } from "@langwatch/trace-contract";
import { useMemo } from "react";
import { LuArrowRight } from "react-icons/lu";

import {
  agentNodeStatusesOf,
  hasMultipleAgents,
  layerAgentCallGraph,
} from "../../../model/agent-call-graph-layout.ts";

const BORDER_BY_STATUS = { error: "border.error", slow: "border.warning", ok: "border" } as const;

/** Agents as columns (callers left of callees) and the calls between them as rows. */
export function AgentCallGraphView({
  graph,
  onSelectSpan,
}: {
  graph: AgentCallGraph;
  onSelectSpan: (spanId: string) => void;
}) {
  const layers = useMemo(() => layerAgentCallGraph({ graph }), [graph]);
  const statuses = useMemo(() => agentNodeStatusesOf({ graph }), [graph]);
  const labelOf = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node.label])),
    [graph.nodes],
  );

  return (
    <VStack align="stretch" gap={4} padding={3} overflow="auto" height="full">
      {!hasMultipleAgents({ graph }) && (
        <Text textStyle="xs" color="fg.muted">
          Only one agent in this trace
        </Text>
      )}
      <HStack
        align="start"
        gap={6}
        flexShrink={0}
        maxHeight="60%"
        overflow="auto"
        aria-label="Agents"
        data-testid="agent-call-graph-nodes"
      >
        {layers.map((layer, index) => (
          <VStack key={index} align="stretch" gap={2} minWidth="160px">
            {layer.map((node) => {
              const status = statuses.get(node.id);
              return (
                <Box
                  key={node.id}
                  data-testid="agent-call-graph-node"
                  data-status={status?.status ?? "ok"}
                  borderWidth="1px"
                  borderColor={BORDER_BY_STATUS[status?.status ?? "ok"]}
                  borderRadius="md"
                  bg="bg.panel"
                  paddingX={3}
                  paddingY={2}
                >
                  <Text textStyle="sm" fontWeight="600" truncate title={node.label}>
                    {node.label}
                  </Text>
                  <Text textStyle="xs" color="fg.muted">
                    {node.spanCount} {node.spanCount === 1 ? "span" : "spans"}
                    {node.cost !== null ? ` · ${formatCost(node.cost)}` : ""}
                  </Text>
                  {node.llmSpanCount > 0 && (
                    <Text
                      textStyle="xs"
                      color="fg.muted"
                      data-testid="agent-call-graph-node-tokens"
                    >
                      {node.llmSpanCount} LLM {node.llmSpanCount === 1 ? "call" : "calls"} ·{" "}
                      {node.promptTokens.toLocaleString()} prompt /{" "}
                      {node.completionTokens.toLocaleString()} completion tokens
                    </Text>
                  )}
                  {status && status.averageMs !== null && (
                    <Text
                      textStyle="xs"
                      color={status.status === "slow" ? "fg.warning" : "fg.muted"}
                      data-testid="agent-call-graph-node-latency"
                    >
                      {status.failedCalls > 0 && (
                        <Text as="span" color="fg.error">
                          {status.failedCalls} failed {status.failedCalls === 1 ? "call" : "calls"}{" "}
                          ·{" "}
                        </Text>
                      )}
                      avg {formatDuration(status.averageMs)} per call
                    </Text>
                  )}
                  {node.hasMissingParent && (
                    <Text textStyle="xs" color="fg.subtle">
                      Caller not in this trace
                    </Text>
                  )}
                </Box>
              );
            })}
          </VStack>
        ))}
      </HStack>
      {graph.edges.length > 0 && (
        <VStack align="stretch" gap={1} flexShrink={0} aria-label="Calls between agents">
          {graph.edges.map((edge) => (
            <EdgeRow
              key={`${edge.from}->${edge.to}`}
              edge={edge}
              fromLabel={labelOf.get(edge.from) ?? edge.from}
              toLabel={labelOf.get(edge.to) ?? edge.to}
              onSelectSpan={onSelectSpan}
            />
          ))}
        </VStack>
      )}
    </VStack>
  );
}

function EdgeRow({
  edge,
  fromLabel,
  toLabel,
  onSelectSpan,
}: {
  edge: AgentCallGraphEdge;
  fromLabel: string;
  toLabel: string;
  onSelectSpan: (spanId: string) => void;
}) {
  const firstSpanId = edge.firstSpanId;
  const averageMs = edge.callCount > 0 ? edge.totalDurationMs / edge.callCount : 0;
  return (
    <Flex
      as="button"
      data-testid="agent-call-graph-edge"
      align="center"
      gap={2}
      paddingX={2}
      paddingY={1}
      borderRadius="md"
      textAlign="left"
      cursor={firstSpanId ? "pointer" : "default"}
      _hover={{ bg: "bg.muted" }}
      onClick={() => {
        if (firstSpanId) onSelectSpan(firstSpanId);
      }}
    >
      <Text textStyle="xs" fontWeight="500" truncate>
        {fromLabel}
      </Text>
      <LuArrowRight aria-label="calls" />
      <Text textStyle="xs" fontWeight="500" truncate>
        {toLabel}
      </Text>
      {edge.a2a && (
        <Badge size="xs" colorPalette="purple" variant="subtle">
          A2A
        </Badge>
      )}
      <Box flex={1} />
      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
        {edge.callCount} {edge.callCount === 1 ? "call" : "calls"}
        {` · avg ${formatDuration(averageMs)} · max ${formatDuration(edge.maxDurationMs)}`}
      </Text>
      {edge.errorCount > 0 && (
        <Badge size="xs" colorPalette="red" variant="subtle">
          {edge.errorCount} {edge.errorCount === 1 ? "error" : "errors"}
        </Badge>
      )}
    </Flex>
  );
}
