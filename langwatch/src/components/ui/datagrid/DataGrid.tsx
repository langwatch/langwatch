import type { ReactNode } from "react";
import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { DataGridToolbar } from "./DataGridToolbar";
import { DataGridTable } from "./DataGridTable";
import { DataGridPagination } from "./DataGridPagination";
import type { Table } from "@tanstack/react-table";
import { DataGridContext } from "./context";

interface DataGridProps<TData> {
  /** Table instance from useReactTable */
  // table: Table<TData>;
  children: ReactNode;
}

/**
 * Main DataGrid component that composes toolbar, table, and pagination
 * Based on the TanStack Table API
 */
function DataGridRoot<TData>({
  children,
}: DataGridProps<TData>) {

  return (
    <Flex direction="column" h="full" bg="white" borderRadius="md" shadow="sm">
      {children}
    </Flex>
  );
}

export const DataGrid = {
  Root: DataGridRoot,
  Toolbar: DataGridToolbar,
  Table: DataGridTable,
  Pagination: DataGridPagination,
};
