import { Box, Button, Card, HStack, Spacer, Text } from "@chakra-ui/react";
import type { PipelineNode } from "@langwatch/ops-contract";
import { useMemo, useState } from "react";

import { useOpsPermission } from "../../../../behavior/ops-session";
import { api } from "../../../../behavior/ops-api";
import { filterTree } from "../../model/queue-pipeline-utils";
import { PipelineTreeNode } from "../blocks/queue-pipeline-tree-node";
import { PipelineTreeFilter } from "../elements/queue-pipeline-tree-filter";

import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback";
export function PipelineTreeCard({
  pipelineTree,
  pausedKeys,
  queueNames,
}: {
  pipelineTree: PipelineNode[];
  pausedKeys: string[];
  queueNames: string[];
}) {
  const toaster = useOpsToaster();
  const showErrorToast = useShowErrorToast();
  const { hasAccess } = useOpsPermission();
  const utils = api.useUtils();
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  const [showIdle, setShowIdle] = useState(false);

  const pausedKeySet = useMemo(() => new Set(pausedKeys), [pausedKeys]);

  // The tree is seeded from a 24h known-pipelines registry, which is right for
  // continuity and wrong for a default view: an idle pipeline renders as a row
  // of pure whitespace, and half the tree was whitespace between the reader and
  // the two pipelines that had work. Idle rows fold away and say how many.
  // Recursive on purpose: a root is a namespace, and namespaces usually carry
  // no counters of their own. Classifying on the root's direct counts alone
  // folded away every parent of a busy child — hiding the work rather than the
  // whitespace this fold exists to remove.
  const { working, idle } = useMemo(() => {
    const hasWork = (node: PipelineNode): boolean =>
      node.pending > 0 || node.active > 0 || node.blocked > 0 || node.children.some(hasWork);
    return {
      working: pipelineTree.filter(hasWork),
      idle: pipelineTree.filter((node) => !hasWork(node)),
    };
  }, [pipelineTree]);

  // A pipeline that gains work leaves the fold on its own, because membership
  // is derived from the counts rather than latched when the fold was closed.
  const visibleTree = useMemo(
    () => (showIdle ? [...working, ...idle] : working),
    [working, idle, showIdle],
  );
  const idleNames = useMemo(() => new Set(idle.map((node) => node.name)), [idle]);

  const filteredTree = useMemo(() => filterTree(visibleTree, filter), [visibleTree, filter]);

  const pauseMutation = api.ops.pausePipeline.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Pipeline paused", type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't pause the pipeline" }),
  });
  const unpauseMutation = api.ops.unpausePipeline.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Pipeline unpaused", type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't unpause the pipeline" }),
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
  function handlePause(key: string) {
    if (queueName) pauseMutation.mutate({ queueName, key });
  }
  function handleUnpause(key: string) {
    if (queueName) unpauseMutation.mutate({ queueName, key });
  }

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack paddingX={4} paddingY={2.5} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="sm" fontWeight="medium">
            Pipeline Tree
          </Text>
          <Spacer />
          {pipelineTree.length > 0 && (
            <PipelineTreeFilter
              filter={filter}
              onFilterChange={setFilter}
              onExpandAll={handleExpandAll}
              onCollapseAll={() => setExpandedPaths(new Set())}
            />
          )}
        </HStack>

        {pipelineTree.length === 0 ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">
              No pipelines discovered yet.
            </Text>
          </Box>
        ) : filteredTree === null ? (
          <Box padding={4}>
            <Text textStyle="xs" color="fg.muted">
              No pipelines match &quot;{filter}&quot;
            </Text>
          </Box>
        ) : (
          <>
            {filteredTree.map((node) => (
              <Box
                key={node.name}
                // Revealed idle pipelines stay distinguishable from working
                // ones rather than padding the list back out again.
                opacity={idleNames.has(node.name) ? 0.55 : 1}
                data-idle={idleNames.has(node.name) ? "true" : "false"}
              >
                <PipelineTreeNode
                  node={node}
                  parentPath=""
                  depth={0}
                  pausedKeys={pausedKeySet}
                  expandedPaths={expandedPaths}
                  onToggleExpand={handleToggleExpand}
                  onPause={handlePause}
                  onUnpause={handleUnpause}
                  hasAccess={hasAccess}
                />
              </Box>
            ))}
            {idle.length > 0 && (
              <Box paddingX={4} paddingY={2}>
                <Button
                  variant="ghost"
                  size="2xs"
                  onClick={() => setShowIdle((prior) => !prior)}
                  data-testid="ops-idle-pipelines-toggle"
                >
                  {showIdle
                    ? `Hide ${idle.length} idle pipelines`
                    : `Show ${idle.length} idle pipelines`}
                </Button>
              </Box>
            )}
          </>
        )}
      </Card.Body>
    </Card.Root>
  );
}
