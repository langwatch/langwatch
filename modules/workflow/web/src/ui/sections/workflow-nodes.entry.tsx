import { HStack, Text } from "@chakra-ui/react";
import type { Node, NodeProps } from "@xyflow/react";
import { forwardRef, type Ref } from "react";
import { Database } from "react-feather";
import type { Component, Entry } from "@langwatch/workflow-contract";
import { useWorkflowNodeHost } from "../elements/workflow-node.host.tsx";
import { ComponentNode, NodeSectionTitle } from "./workflow-nodes.tsx";

/**
 * The workflow's entry point on the canvas: entry fields under "Inputs", or
 * a compact dataset marker when one is attached. Attach/seed semantics live
 * in the store's `attachEntryDataset`; the entry drawer views and edits.
 */
export const EntryNode = forwardRef(function EntryNode(
  props: NodeProps<Node<Component>>,
  ref: Ref<HTMLDivElement>,
) {
  const data = props.data as Entry;

  const { useEntryDatasetTotal } = useWorkflowNodeHost();
  const total = useEntryDatasetTotal(data.dataset);

  return (
    <ComponentNode ref={ref} {...props} outputsTitle="Inputs" hidePlayButton>
      {data.dataset && (
        <>
          <NodeSectionTitle>Attached Dataset</NodeSectionTitle>
          <HStack
            gap={1.5}
            paddingX={2}
            paddingY={1}
            borderRadius="md"
            background="bg.muted"
            maxWidth="full"
            data-testid="entry-dataset-marker"
          >
            <Database size={12} style={{ flexShrink: 0 }} />
            <Text fontSize="11px" truncate>
              {data.dataset.name ?? "Dataset"}
            </Text>
            {total !== void 0 && total !== null && (
              <Text fontSize="11px" color="fg.subtle" flexShrink={0}>
                ({total} {total === 1 ? "row" : "rows"})
              </Text>
            )}
          </HStack>
        </>
      )}
    </ComponentNode>
  );
});
