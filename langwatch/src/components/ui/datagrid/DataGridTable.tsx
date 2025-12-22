import { Fragment } from "react";
import { Box, Flex, Table, Text, Button } from "@chakra-ui/react";
import {
  flexRender,
  type Table as TanStackTable,
  type Row,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useDataGridContext } from "./context";

interface DataGridTableProps<T> {
  table: TanStackTable<T>;
  renderExpandedContent: (row: Row<T>) => React.ReactNode;
}

/**
 * Core table component using TanStack Table
 * Handles grouping, aggregation, placeholder cells, and row expansion correctly
 */
export function DataGridTable<T>({
  table,
  renderExpandedContent,
}: DataGridTableProps<T>) {
  return (
    <Box overflowX="auto">
      <Table.Root size="sm">
        <Table.Header>
          {table.getHeaderGroups().map((headerGroup) => (
            <Table.Row key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <Table.ColumnHeader
                  key={header.id}
                  colSpan={header.colSpan}
                  style={{
                    width: header.getSize(),
                    minWidth: header.column.columnDef.minSize,
                    maxWidth: header.column.columnDef.maxSize,
                  }}
                >
                  {header.isPlaceholder ? null : (
                    <Flex align="center" gap={2}>
                      {header.column.getCanGroup() ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={header.column.getToggleGroupingHandler()}
                          cursor="pointer"
                        >
                          {header.column.getIsGrouped()
                            ? `🛑(${header.column.getGroupedIndex()}) `
                            : `👊 `}
                        </Button>
                      ) : null}
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
                    </Flex>
                  )}
                </Table.ColumnHeader>
              ))}
            </Table.Row>
          ))}
        </Table.Header>
        <Table.Body>
          {table.getRowModel().rows.length === 0 ? (
            <Table.Row>
              <Table.Cell colSpan={table.getHeaderGroups()[0]?.headers.length ?? 1}>
                <Text textAlign="center" py={8} color="gray.500">
                  No data available
                </Text>
              </Table.Cell>
            </Table.Row>
          ) : (
            table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <Table.Row>
                  {row.getVisibleCells().map((cell) => {
                    const isGrouped = cell.getIsGrouped();
                    const isAggregated = cell.getIsAggregated();
                    const isPlaceholder = cell.getIsPlaceholder();

                    return (
                      <Table.Cell
                        key={cell.id}
                        style={{
                          width: cell.column.getSize(),
                          minWidth: cell.column.columnDef.minSize,
                          maxWidth: cell.column.columnDef.maxSize,
                          background: isGrouped
                            ? "#0aff0082"
                            : isAggregated
                              ? "#ffa50078"
                              : isPlaceholder
                                ? "#ff000042"
                                : "white",
                        }}
                      >
                        {isGrouped ? (
                          <Flex align="center" gap={2}>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={row.getToggleExpandedHandler()}
                              cursor={row.getCanExpand() ? "pointer" : "normal"}
                              disabled={!row.getCanExpand()}
                            >
                              {row.getIsExpanded() ? (
                                <ChevronDown size={16} />
                              ) : (
                                <ChevronRight size={16} />
                              )}
                            </Button>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                            <Text as="span" color="gray.500" fontSize="sm">
                              ({row.subRows.length})
                            </Text>
                          </Flex>
                        ) : isAggregated ? (
                          flexRender(
                            cell.column.columnDef.aggregatedCell ??
                              cell.column.columnDef.cell,
                            cell.getContext()
                          )
                        ) : isPlaceholder ? null : (
                          flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )
                        )}
                      </Table.Cell>
                    );
                  })}
                </Table.Row>
                {row.getIsExpanded() && renderExpandedContent && (
                  <Table.Row>
                    <Table.Cell colSpan={row.getAllCells().length} style={{ padding: 0 }}>
                      <Box
                        bg="gray.50"
                        borderTop="1px solid"
                        borderBottom="1px solid"
                        borderColor="gray.200"
                        p={4}
                      >
                        {renderExpandedContent(row)}
                      </Box>
                    </Table.Cell>
                  </Table.Row>
                )}
              </Fragment>
            ))
          )}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
