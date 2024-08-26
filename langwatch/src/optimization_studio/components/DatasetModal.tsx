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
import { type Node, type NodeProps } from "@xyflow/react";
import { nanoid } from "nanoid";
import { useCallback, useMemo } from "react";
import { ArrowLeft, Edit2 } from "react-feather";
import {
  DatasetGrid,
  type DatasetColumnDef,
} from "../../components/datasets/DatasetGrid";
import {
  DatasetTable,
  type InMemoryDataset,
} from "../../components/datasets/DatasetTable";
import type {
  DatasetColumnType,
  DatasetRecordEntry,
} from "../../server/datasets/types";
import type { Component, Entry, Field } from "../types/dsl";
import { useWorkflowStore } from "../hooks/useWorkflowStore";

export function DatasetModal({
  isOpen,
  onClose,
  node,
}: {
  isOpen: boolean;
  onClose: () => void;
  node: NodeProps<Node<Component>> | Node<Component>;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="full">
      <ModalOverlay />
      <ModalContent
        marginX="32px"
        marginTop="32px"
        width="calc(100vw - 64px)"
        minHeight="0"
        height="calc(100vh - 64px)"
        borderRadius="8px"
        overflowY="auto"
      >
        <ModalCloseButton />
        <ModalHeader>
          <Button
            fontSize="14px"
            fontWeight="bold"
            color="gray.500"
            variant="link"
            leftIcon={<ArrowLeft size={16} />}
          >
            Datasets
          </Button>
        </ModalHeader>
        <ModalBody paddingBottom="32px">
          {isOpen && <EditDatasetModalTable node={node} />}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export const EditDatasetModalTable = ({
  node,
}: {
  node: NodeProps<Node<Component>> | Node<Component>;
}) => {
  const { rows, columns } = useGetDatasetData(node.data);

  const columnTypes = useMemo(() => {
    const fields = Object.fromEntries(
      (node.data.outputs ?? []).map((field) => [field.identifier, field.type])
    );

    const typeMap: Record<Field["type"], DatasetColumnType> = {
      str: "string",
      float: "number",
      int: "number",
      bool: "boolean",
      "list[str]": "json",
      "list[float]": "json",
      "list[int]": "json",
      "list[bool]": "json",
      signature: "json",
      llm: "json",
    };

    return Object.fromEntries(
      columns.map((column) => [
        column,
        (fields[column] ? typeMap[fields[column]] : "string") ?? "string",
      ])
    );
  }, [columns, node.data.outputs]);

  // Only update the datset from parent to child once the modal is open again
  const inMemoryDataset = useMemo(
    () => ({
      name: "dataset" in node.data ? node.data.dataset?.name : undefined,
      datasetRecords: rows ?? [],
      columnTypes: columnTypes ?? {},
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const { setNode } = useWorkflowStore(({ setNode }) => ({ setNode }));

  const onUpdateDataset = useCallback(
    (dataset: InMemoryDataset) => {
      setNode({
        id: node.id,
        data: {
          ...(node.data as Entry),
          dataset: {
            ...(node.data as Entry).dataset,
            inline: transpostRowsFirstToColumnsFirstWithoutId(
              dataset.datasetRecords
            ),
          },
        } as Entry,
      });
    },
    [node.data, node.id, setNode]
  );

  return (
    <DatasetTable
      inMemoryDataset={inMemoryDataset}
      onUpdateDataset={onUpdateDataset}
      isEmbedded={true}
    />
  );
};

export const useGetDatasetData = (
  data: Component,
  maxLines: number | undefined = undefined,
  maxColumns: number | undefined = undefined
) => {
  const data_: Record<string, string[]> | undefined =
    "dataset" in data && data.dataset?.inline ? data.dataset.inline : undefined;

  const columns = useMemo(() => {
    const columns = Object.keys(data_ ?? {}).filter((key) => key !== "id");
    if (maxColumns && columns.length > maxColumns) {
      return new Set(columns.slice(0, maxColumns));
    }

    return new Set(columns);
  }, [data_, maxColumns]);

  const rows: DatasetRecordEntry[] | undefined = useMemo(() => {
    const rows = data_
      ? transposeIDlessColumnsFirstToRowsFirstWithId(data_).slice(0, maxLines)
      : undefined;

    return rows?.map((row) => {
      const row_ = Object.fromEntries(
        Object.entries(row).filter(([key]) => key === "id" || columns.has(key))
      );
      if (!row_.id) {
        row_.id = nanoid();
      }

      return row_;
    }) as DatasetRecordEntry[];
  }, [columns, data_, maxLines]);

  return {
    rows,
    columns: Array.from(columns),
  };
};

export function DatasetPreview({
  data,
  onClick,
}: {
  data: Entry;
  onClick: () => void;
}) {
  const { rows, columns } = useGetDatasetData(data, 5, 4);

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

  if (!rows) {
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
        role="button"
        aria-label="Edit dataset"
        onClick={onClick}
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
          paddingY={2}
          paddingX={4}
          borderRadius="6px"
        >
          <Edit2 size={20} />
          <Text>Edit</Text>
        </HStack>
      </Center>
      <DatasetGrid columnDefs={columnDefs} rowData={rows} />
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

function transpostRowsFirstToColumnsFirstWithoutId(
  data: DatasetRecordEntry[]
): Record<string, string[]> {
  return data.reduce(
    (acc, row) => {
      Object.entries(row).forEach(([key, value]) => {
        if (key === "id" || key === "selected") return;
        acc[key] = acc[key] ?? [];
        acc[key].push(value);
      });
      return acc;
    },
    {} as Record<string, string[]>
  );
}
