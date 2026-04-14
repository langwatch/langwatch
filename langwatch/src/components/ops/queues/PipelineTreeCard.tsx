import { useMemo, useState } from "react";
import { Box, Button, Card, HStack, Input, Spacer, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import type { PipelineNode } from "~/server/app-layer/ops/types";
import { toaster } from "~/components/ui/toaster";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";
import { filterTree } from "./pipelineUtils";
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
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform" || scope?.kind === "organization";
  const utils = api.useContext();
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  const pausedKeySet = useMemo(() => new Set(pausedKeys), [pausedKeys]);
  const filteredTree = useMemo(() => filterTree(pipelineTree, filter), [pipelineTree, filter]);

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

  function handleExpandAll() {
    const all = new Set<string>();
    function walk(nodes: PipelineNode[], parentPath: string) {
      for (const node of nodes) {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        all.add(path);
        walk(node.children, path);
      }
    }
    walk(pipelineTree, "");
    setExpandedPaths(all);
  }

  const queueName = queueNames[0];
  function handlePause(key: string) { if (queueName) pauseMutation.mutate({ queueName, key }); }
  function handleUnpause(key: string) { if (queueName) unpauseMutation.mutate({ queueName, key }); }

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="sm" fontWeight="medium">Pipeline Tree</Text>
          <Spacer />
          {pipelineTree.length > 0 && (
            <>
              <Box position="relative" width="200px">
                <Box position="absolute" left={2.5} top="50%" transform="translateY(-50%)" zIndex={1}>
                  <Search size={11} color="var(--chakra-colors-fg-muted)" />
                </Box>
                <Input size="xs" placeholder="Filter..." value={filter} onChange={(e) => setFilter(e.target.value)} paddingLeft={7} />
              </Box>
              <Button variant="ghost" size="2xs" onClick={handleExpandAll}>Expand all</Button>
              <Button variant="ghost" size="2xs" onClick={() => setExpandedPaths(new Set())}>Collapse</Button>
            </>
          )}
        </HStack>

        {pipelineTree.length === 0 ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">No pipelines discovered yet.</Text>
          </Box>
        ) : filteredTree === null ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">No pipelines match &quot;{filter}&quot;</Text>
          </Box>
        ) : (
          filteredTree.map((node) => (
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
              canManage={canManage}
              queueNames={queueNames}
            />
          ))
        )}
      </Card.Body>
    </Card.Root>
  );
}
