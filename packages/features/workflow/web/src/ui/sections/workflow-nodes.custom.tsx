import { Alert, Text } from "@chakra-ui/react";
import type { Node, NodeProps } from "@xyflow/react";
import { useUpdateNodeInternals } from "@xyflow/react";
import type { Ref } from "react";
import { forwardRef, useEffect } from "react";
import type { Custom } from "@langwatch/workflow-contract";
import { useWorkflowNodeHost } from "../elements/workflow-node.host";
import { ComponentNode } from "./workflow-nodes";

export const CustomNode = forwardRef(function CustomNode(
  props: NodeProps<Node<Custom>>,
  ref: Ref<HTMLDivElement>,
) {
  return (
    <ComponentNode ref={ref} {...props}>
      <LatestComponentVersionCheck node={props} />
    </ComponentNode>
  );
});

const LatestComponentVersionCheck = ({ node }: { node: NodeProps<Node<Custom>> }) => {
  const { useComponentVersion } = useWorkflowNodeHost();
  const { currentVersion } = useComponentVersion(node);

  const updateNodeInternals = useUpdateNodeInternals();

  useEffect(() => {
    if (currentVersion) {
      // Small timeout to ensure the DOM has updated
      const updateInternalsTimeout = setTimeout(() => {
        updateNodeInternals(node.id);
      }, 0);
      return () => clearTimeout(updateInternalsTimeout);
    }
    // No timer was scheduled, so there is nothing to clear. Stated rather than
    // fallen through, for `noImplicitReturns`.
    return undefined;
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
