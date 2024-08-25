import {
  Box,
  Button,
  Center,
  HStack,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Text,
} from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useMemo } from "react";
import {
  DatasetGrid,
  type DatasetColumnDef,
} from "../../components/datasets/DatasetGrid";
import type { DatasetRecordEntry } from "../../server/datasets/types";
import type { Component, Entry } from "../types/dsl";
import { Edit2 } from "react-feather";

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

export const getDatasetRows = (data: Component) => {
  const data_: Record<string, string[]> | undefined =
    "dataset" in data &&
    data.dataset &&
    "inline" in data.dataset &&
    data.dataset.inline;

  return data_;
};

export function DatasetPreview({ data }: { data: Entry }) {
  const data_ = getDatasetRows(data);

  const columns = useMemo(() => {
    const columns = Object.keys(data_ ?? {}).filter((key) => key !== "id");
    if (columns.length > 4) {
      return new Set(columns.slice(0, 4));
    }

    return new Set(columns);
  }, [data_]);

  const rowData = useMemo(() => {
    const rows = data_
      ? transposeIDlessColumnsFirstToRowsFirstWithId(data_).slice(0, 5)
      : undefined;

    return rows?.map((row) => {
      const row_ = Object.fromEntries(
        Object.entries(row).filter(([key]) => key === "id" || columns.has(key))
      );

      return row_;
    });
  }, [columns, data_]);

  const columnDefs = useMemo(() => {
    const headers: DatasetColumnDef[] = Array.from(columns).map((field) => ({
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
    <Box
      width="100%"
      maxHeight="200px"
      overflow="scroll"
      borderBottom="1px solid #bdc3c7"
      className="dataset-preview"
      position="relative"
    >
      <Center
        position="absolute"
        top={0}
        left={0}
        width="100%"
        height="100%"
        background="rgba(0, 0, 0, 0.2)"
        zIndex={10}
        opacity={0}
        cursor="pointer"
        transition="opacity 0.2s ease-in-out"
        _hover={{
          opacity: 1,
        }}
      >
        <HStack
          spacing={2}
          fontSize={18}
          fontWeight="bold"
          color="white"
          background="rgba(0, 0, 0, .5)"
          padding={2}
          borderRadius="6px"
        >
          <Edit2 size={20} />
          <Text>Edit</Text>
        </HStack>
      </Center>
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
