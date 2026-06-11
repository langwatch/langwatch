import { HStack, Text } from "@chakra-ui/react";
import type { Node, NodeProps } from "@xyflow/react";
import { forwardRef, type Ref } from "react";
import { Database } from "react-feather";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import type { Component, Entry } from "../../types/dsl";
import { ComponentNode, NodeSectionTitle } from "./Nodes";

/**
 * The workflow's entry point on the canvas. Renders the entry fields
 * under an "Inputs" title and, when a dataset is attached, a compact
 * marker with the dataset name and row count instead of an embedded
 * grid. The attach/seed semantics live in the store's
 * attachEntryDataset; viewing and editing happen in the entry drawer.
 */
export const EntryNode = forwardRef(function EntryNode(
  props: NodeProps<Node<Component>>,
  ref: Ref<HTMLDivElement>,
) {
  const data = props.data as Entry;

  const { total } = useGetDatasetData({
    dataset: data.dataset,
    preview: true,
  });

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
            {total !== undefined && total !== null && (
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
