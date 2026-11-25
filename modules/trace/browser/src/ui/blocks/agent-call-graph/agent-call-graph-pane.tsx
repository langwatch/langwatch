import { Button, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import type { AgentCallGraph } from "@langwatch/trace-contract";
import { RotateCw } from "lucide-react";

import { AgentCallGraphView } from "./agent-call-graph-view.tsx";

/** The Agents tab's body: the graph, a skeleton while it loads, or the failure with a retry. */
export function AgentCallGraphPane({
  graph,
  isError,
  onRetry,
  onSelectSpan,
}: {
  graph: AgentCallGraph | undefined;
  isError: boolean;
  onRetry: () => void;
  onSelectSpan: (spanId: string) => void;
}) {
  if (graph) return <AgentCallGraphView graph={graph} onSelectSpan={onSelectSpan} />;
  if (isError) {
    return (
      <VStack
        gap={2}
        justify="center"
        height="full"
        padding={4}
        data-testid="agent-call-graph-error"
      >
        <Text textStyle="sm" color="fg.muted">
          Couldn't load the agents for this trace
        </Text>
        <Button size="xs" variant="outline" onClick={onRetry}>
          <RotateCw />
          Retry
        </Button>
      </VStack>
    );
  }
  return (
    <HStack
      align="start"
      gap={6}
      padding={3}
      aria-busy="true"
      aria-label="Loading agents"
      data-testid="agent-call-graph-loading"
    >
      {[0, 1].map((column) => (
        <VStack key={column} align="stretch" gap={2} minWidth="160px">
          <Skeleton height="56px" borderRadius="md" />
        </VStack>
      ))}
    </HStack>
  );
}
