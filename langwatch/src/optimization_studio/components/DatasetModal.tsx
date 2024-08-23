import {
  Box,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
} from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import type { Component } from "../types/dsl";
import {
  DatasetGrid,
  type DatasetColumnDef,
} from "../../components/datasets/DatasetGrid";
import type { DatasetRecordEntry } from "../../server/datasets/types";
import { nanoid } from "nanoid";
import { useMemo } from "react";

export function DatasetModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Dataset</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Text>Dataset</Text>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export function DatasetPreview({ node }: { node: Node<Component> }) {
  const data: Record<string, string[]> | undefined =
    "dataset" in node.data &&
    node.data.dataset &&
    "inline" in node.data.dataset &&
    node.data.dataset.inline
      ? node.data.dataset.inline
      : undefined;

  const rowData = useMemo(
    () =>
      data
        ? transposeIDlessColumnsFirstToRowsFirstWithId(data).slice(0, 5)
        : undefined,
    [data]
  );

  const columns = useMemo(
    () => Object.keys(data ?? {}).filter((key) => key !== "id"),
    [data]
  );

  const columnDefs = useMemo(() => {
    const headers: DatasetColumnDef[] = columns.map((field) => ({
      headerName: field,
      field,
      type_: "string",
      cellClass: "v-align",
      sortable: false,
    }));

    // Add row number column
    headers.unshift({
      headerName: "#",
      valueGetter: "node.rowIndex + 1",
      type_: "number",
      initialWidth: 48,
      pinned: "left",
      sortable: false,
      filter: false,
      editable: false,
    });

    return headers;
  }, [columns]);

  if (!rowData) {
    return null;
  }

  return (
    <Box width="100%" maxHeight="200px" overflow="scroll" borderBottom="1px solid #bdc3c7">
      <DatasetGrid columnDefs={columnDefs} rowData={rowData} />
    </Box>
  );
}

function transposeIDlessColumnsFirstToRowsFirstWithId(
  data: Record<string, string[]>
): DatasetRecordEntry[] {
  return Object.entries(data).reduce((acc, [column, values]) => {
    values.forEach((value, index) => {
      acc[index] = acc[index] ?? { id: nanoid() };
      acc[index][column] = value;
    });
    return acc;
  }, [] as DatasetRecordEntry[]);
}
