import { Badge, Box, Button, HStack, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Pause, Play } from "lucide-react";
import type { PipelineNode } from "~/server/app-layer/ops/types";
import { isNodeDirectlyPaused, isNodePaused } from "./pipelineUtils";

export function PipelineTreeNode({
  node,
  parentPath,
  depth,
  pausedKeys,
  expandedPaths,
  onToggleExpand,
  onPause,
  onUnpause,
  canManage,
  queueNames,
}: {
  node: PipelineNode;
  parentPath: string;
  depth: number;
  pausedKeys: Set<string>;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  onPause: (key: string) => void;
  onUnpause: (key: string) => void;
  canManage: boolean;
  queueNames: string[];
}) {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedPaths.has(path);
  const paused = isNodePaused(node, parentPath, pausedKeys);
  const directlyPaused = isNodeDirectlyPaused(path, pausedKeys);
  const isLeaf = !hasChildren;

  return (
    <>
      <HStack
        paddingY={1}
        paddingX={3}
        paddingLeft={`${depth * 20 + 12}px`}
        cursor={hasChildren ? "pointer" : "default"}
        _hover={{ bg: "bg.subtle" }}
        onClick={() => hasChildren && onToggleExpand(path)}
        borderBottom="1px solid"
        borderBottomColor="border"
        gap={2}
        opacity={paused ? 0.6 : 1}
      >
        <Box width="14px" flexShrink={0}>
          {hasChildren ? (
            isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />
          ) : null}
        </Box>

        <Text
          textStyle="xs"
          fontWeight={depth === 0 ? "semibold" : "medium"}
          fontFamily={isLeaf ? "mono" : undefined}
          flex={1}
          color={paused ? "orange.500" : undefined}
        >
          {node.name}
        </Text>

        {paused && (
          <Badge size="xs" colorPalette="orange" variant="subtle">Paused</Badge>
        )}

        <HStack gap={1} flexShrink={0}>
          {node.pending > 0 && (
            <Badge size="xs" colorPalette="blue" variant="subtle">{node.pending}</Badge>
          )}
          {node.active > 0 && (
            <Badge size="xs" colorPalette="green" variant="subtle">{node.active}</Badge>
          )}
          {node.blocked > 0 && (
            <Badge size="xs" colorPalette="red" variant="subtle">{node.blocked}</Badge>
          )}
        </HStack>

        {canManage && (
          <Box flexShrink={0} onClick={(e) => e.stopPropagation()}>
            {directlyPaused ? (
              <Button variant="ghost" size="2xs" colorPalette="green" onClick={() => onUnpause(path)}>
                <Play size={10} />
              </Button>
            ) : !paused ? (
              <Button variant="ghost" size="2xs" colorPalette="orange" onClick={() => onPause(path)}>
                <Pause size={10} />
              </Button>
            ) : null}
          </Box>
        )}
      </HStack>

      {hasChildren && isExpanded &&
        node.children.map((child) => (
          <PipelineTreeNode
            key={child.name}
            node={child}
            parentPath={path}
            depth={depth + 1}
            pausedKeys={pausedKeys}
            expandedPaths={expandedPaths}
            onToggleExpand={onToggleExpand}
            onPause={onPause}
            onUnpause={onUnpause}
            canManage={canManage}
            queueNames={queueNames}
          />
        ))}
    </>
  );
}
