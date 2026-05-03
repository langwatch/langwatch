import { useMemo, useState } from "react";
import { Box, Card, HStack, Spacer, Text } from "@chakra-ui/react";
import type { PipelineNode } from "~/server/app-layer/ops/types";
import { toaster } from "~/components/ui/toaster";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import { PipelineTreeNode } from "./PipelineTreeNode";

export function PipelineTreeCard({
  pipelineTree,
  pausedKeys,
  queueNames,
}: {
  pipelineTree: PipelineNode[];
  pausedKeys: string[];
  queueNames: string[];
}) {
  const { hasAccess } = useOpsPermission();
  const utils = api.useContext();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  const pausedKeySet = useMemo(() => new Set(pausedKeys), [pausedKeys]);

  const pauseMutation = api.ops.pausePipeline.useMutation({
    onSuccess: () => { toaster.create({ title: "Pipeline paused", type: "success" }); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Failed to pause", description: error.message, type: "error" }); },
  });
  const unpauseMutation = api.ops.unpausePipeline.useMutation({
    onSuccess: () => { toaster.create({ title: "Pipeline unpaused", type: "success" }); void utils.ops.invalidate(); },
    onError: (error) => { toaster.create({ title: "Failed to unpause", description: error.message, type: "error" }); },
  });

  function handleToggleExpand(path: string) {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  const queueName = queueNames[0];
  function handlePause(key: string) { if (queueName) pauseMutation.mutate({ queueName, key }); }
  function handleUnpause(key: string) { if (queueName) unpauseMutation.mutate({ queueName, key }); }

  return (
    <Card.Root overflow="hidden">
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="sm" fontWeight="medium">Pipelines</Text>
          <Spacer />
          <Text textStyle="2xs" color="fg.subtle">click to expand · pause / unpause inline</Text>
        </HStack>

        {pipelineTree.length === 0 ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">No pipelines discovered yet.</Text>
          </Box>
        ) : (
          pipelineTree.map((node) => (
            <PipelineTreeNode
              key={node.name}
              node={node}
              parentPath=""
              depth={0}
              pausedKeys={pausedKeySet}
              expandedPaths={expandedPaths}
              onToggleExpand={handleToggleExpand}
              onPause={handlePause}
              onUnpause={handleUnpause}
              hasAccess={hasAccess}
              queueNames={queueNames}
            />
          ))
        )}
      </Card.Body>
    </Card.Root>
  );
}
