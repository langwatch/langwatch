import { type Node, type NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import { ComponentNode } from "./Nodes";

import { Alert, Text } from "@chakra-ui/react";

import { useUpdateNodeInternals } from "@xyflow/react";
import { forwardRef, useEffect } from "react";
import { useComponentVersion } from "../../hooks/useComponentVersion";
import { type Custom } from "../../types/dsl";

export const CustomNode = forwardRef(function CustomNode(
  props: NodeProps<Node<Custom>>,
  ref: Ref<HTMLDivElement>
) {
  return (
    <ComponentNode ref={ref} {...props}>
      <LatestComponentVersionCheck node={props} />
    </ComponentNode>
  );
});

const LatestComponentVersionCheck = ({
  node,
}: {
  node: NodeProps<Node<Custom>>;
}) => {
  const { currentVersion } = useComponentVersion(node);

  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (currentVersion) {
      // Small timeout to ensure the DOM has updated
      setTimeout(() => {
        updateNodeInternals(node.id);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVersion]);

  if (!currentVersion) return null;

  return (
    <>
      {node?.data.isCustom && !currentVersion?.isPublishedVersion && (
        <Alert.Root padding="4px">
          <Alert.Indicator />
          <Alert.Content>
            <Text>Version outdated</Text>
          </Alert.Content>
        </Alert.Root>
      )}
    </>
  );
};
