import { HStack, Text } from "@chakra-ui/react";
import type { Node, NodeProps } from "@xyflow/react";
import { forwardRef, type Ref } from "react";
import { Database } from "react-feather";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import type { Component, Entry } from "../../types/dsl";
import { ComponentNode, NodeSectionTitle } from "./Nodes";

/**
 * The workflow's entry point. A dataset CAN be attached as the data
 * source for evaluations/optimizations, but it is not required — the
 * node's fields are the workflow inputs, user-owned, and a dataset
 * attach only seeds them. Attached datasets render as a compact marker
 * (name + row count), not an embedded data grid; the data itself lives
 * one click away in the drawer.
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
          <NodeSectionTitle>Dataset</NodeSectionTitle>
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
                ({total} rows)
              </Text>
            )}
          </HStack>
        </>
      )}
    </ComponentNode>
  );
});
