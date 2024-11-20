import { forwardRef } from "@chakra-ui/react";
import { type Node, type NodeProps } from "@xyflow/react";
import type { Ref } from "react";
import type { End } from "../../types/dsl";
import { ComponentNode } from "./Nodes";

import { Alert, AlertIcon, Text } from "@chakra-ui/react";

import { useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
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
  }, [currentVersion]);

  if (!currentVersion) return null;

  return (
    <>
      {node?.data.isCustom && !currentVersion?.isPublishedVersion && (
        <Alert status="warning" padding="4px">
          <AlertIcon />
          Version outdated
        </Alert>
      )}
    </>
  );
};
