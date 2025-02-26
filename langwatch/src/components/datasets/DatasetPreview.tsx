import { Box, Center, HStack, Text } from "@chakra-ui/react";
import { useMemo, type ComponentProps } from "react";
import { Edit2 } from "react-feather";
import { DatasetGrid, type DatasetColumnDef } from "./DatasetGrid";
import type {
  DatasetColumns,
  DatasetRecordEntry,
} from "../../server/datasets/types";

export function DatasetPreview({
  rows,
  columns,
  onClick,
  ...props
}: {
  rows: DatasetRecordEntry[];
  columns: DatasetColumns;
  onClick?: () => void;
} & Omit<ComponentProps<typeof Box>, "columns" | "rows">) {
  const columnDefs = useMemo(() => {
    const headers: DatasetColumnDef[] = columns.map((column) => ({
      headerName: column.name,
      field: column.name,
      type_: column.type,
      cellClass: "v-align",
      sortable: false,
      editable: false,
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
      borderBottom={
        rows.length === 0 ? "1px solid rgba(189, 195, 199, 0.58)" : "none"
      }
      className="dataset-preview"
      position="relative"
      {...props}
    >
      {onClick && (
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
            gap={2}
            fontSize="18px"
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
      )}
      <DatasetGrid columnDefs={columnDefs} rowData={rows} />
    </Box>
  );
}
