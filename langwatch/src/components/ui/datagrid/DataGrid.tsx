import type { ReactNode } from "react";
import { Flex } from "@chakra-ui/react";
import { DataGridToolbar } from "./DataGridToolbar";
import { DataGridTable } from "./DataGridTable";
import { DataGridPagination } from "./DataGridPagination";

interface DataGridProps<TData> {
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
    <Flex direction="column" h="full">
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
