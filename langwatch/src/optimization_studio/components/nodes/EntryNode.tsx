import { Box, useDisclosure } from "@chakra-ui/react";

import { type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import { DatasetPreview } from "../../../components/datasets/DatasetPreview";
import { useGetDatasetData } from "../../hooks/useGetDatasetData";
import { type Component, type Entry } from "../../types/dsl";
import { DatasetModal } from "../DatasetModal";
import { ComponentNode, NodeSectionTitle } from "./Nodes";

export function EntryNode(props: NodeProps<Node<Component>>) {
  const [rendered, setRendered] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    setRendered(true);
  }, []);

  const { rows, columns } = useGetDatasetData({
    dataset: (props.data as Entry).dataset,
    preview: true,
  });

  return (
    <ComponentNode
      {...props}
      outputsName="Fields"
      hidePlayButton
      fieldsAfter={
        <>
          <NodeSectionTitle>Dataset</NodeSectionTitle>
          <Box
            width="200%"
            transform="scale(0.5)"
            transformOrigin="top left"
            height={`${(34 + 28 * (rows?.length ?? 0)) / 2}px`}
          >
            {rendered && (
              <DatasetPreview
                rows={rows}
                columns={columns.map((column) => ({
                  name: column.name,
                  type: "string",
                }))}
                onClick={onOpen}
              />
            )}
          </Box>
          <DatasetModal
            isOpen={isOpen}
            editingDataset={(props.data as Entry).dataset}
            onClose={onClose}
            node={props}
          />
        </>
      }
    />
  );
}
