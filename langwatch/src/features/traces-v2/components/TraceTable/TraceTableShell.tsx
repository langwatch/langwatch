import { Box, Button, HStack, Icon, type SystemStyleObject } from "@chakra-ui/react";
import { flexRender, type Table } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import type React from "react";
import { useCallback, useRef, useState } from "react";
import { Table as TableEl, Th, Thead, Tr } from "./TablePrimitives";

type Color = NonNullable<SystemStyleObject["color"]>;

export interface ColumnMeta {
  align?: "left" | "right";
  flex?: boolean;
}

interface TraceTableShellProps<T> {
  table: Table<T>;
  minWidth: string;
  children: React.ReactNode;
  stickyFirstColumn?: boolean;
}

export function TraceTableShell<T>({
  table,
  minWidth,
  children,
  stickyFirstColumn = false,
}: TraceTableShellProps<T>): React.ReactElement {
  return (
    <TableEl
      width="full"
      css={{
        borderCollapse: "collapse",
        minWidth,
        position: "relative",
        zIndex: 1,
      }}
    >
      <Thead position="sticky" top={0} zIndex={2} bg="bg.surface">
        {table.getHeaderGroups().map((headerGroup) => (
          <Tr
            key={headerGroup.id}
            borderBottomWidth="1px"
            borderColor="border.muted"
          >
            {headerGroup.headers.map((header, i) => {
              const meta = header.column.columnDef.meta as
                | ColumnMeta
                | undefined;
              const size = header.column.getSize();
              const canSort = header.column.getCanSort();
              return (
                <Th
                  key={header.id}
                  width={meta?.flex ? undefined : `${size}px`}
                  minWidth={`${header.column.columnDef.minSize}px`}
                  textAlign={meta?.align ?? "left"}
                  fontSize="10px"
                  fontWeight="500"
                  color="fg.subtle/70"
                  textTransform="uppercase"
                  letterSpacing="0.06em"
                  whiteSpace="nowrap"
                  transition="none"
                  position={stickyFirstColumn && i === 0 ? "sticky" : "relative"}
                  left={stickyFirstColumn && i === 0 ? 0 : undefined}
                  zIndex={stickyFirstColumn && i === 0 ? 3 : undefined}
                  bg={stickyFirstColumn && i === 0 ? "bg.surface" : undefined}
                >
                  {canSort ? (
                    <Button
                      type="button"
                      variant="ghost"
                      width="full"
                      height="auto"
                      minHeight="unset"
                      paddingX={2}
                      paddingY={1}
                      justifyContent={
                        meta?.align === "right" ? "flex-end" : "flex-start"
                      }
                      color="inherit"
                      userSelect="none"
                      fontSize="inherit"
                      fontWeight="inherit"
                      letterSpacing="inherit"
                      textTransform="inherit"
                      bg="transparent"
                      onClick={header.column.getToggleSortingHandler()}
                      _hover={{ color: "fg", bg: "transparent" }}
                      _active={{ bg: "transparent" }}
                      _focusVisible={{ bg: "transparent" }}
                    >
                      <HStack gap={0.5}>
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <Icon
                          boxSize="12px"
                          color="blue.fg"
                          visibility={
                            header.column.getIsSorted() ? "visible" : "hidden"
                          }
                        >
                          {header.column.getIsSorted() === "desc" ? (
                            <ChevronDown />
                          ) : (
                            <ChevronUp />
                          )}
                        </Icon>
                      </HStack>
                    </Button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                  {/* Resize handle — skip for flex columns and pinned first column */}
                  {!meta?.flex && !(stickyFirstColumn && i === 0) && (
                    <ColumnResizeHandle
                      onResize={() => {
                        // Column resize is handled by TanStack Table's built-in resize handler
                        // For now, the visual handle is shown; actual resize wiring requires
                        // enableColumnResizing on the table instance
                      }}
                    />
                  )}
                </Th>
              );
            })}
          </Tr>
        ))}
      </Thead>
      {children}
    </TableEl>
  );
}

function ColumnResizeHandle({
  onResize,
}: {
  onResize: (deltaX: number) => void;
}) {
  const startXRef = useRef(0);
  const isDraggingRef = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      startXRef.current = e.clientX;
      isDraggingRef.current = true;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isDraggingRef.current) return;
        const delta = moveEvent.clientX - startXRef.current;
        if (Math.abs(delta) > 2) {
          onResize(delta);
          startXRef.current = moveEvent.clientX;
        }
      };

      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onResize],
  );

  return (
    <Box
      position="absolute"
      right={0}
      top={0}
      bottom={0}
      width="4px"
      cursor="col-resize"
      bg="transparent"
      _hover={{ bg: "blue.solid" }}
      onMouseDown={handleMouseDown}
      zIndex={4}
    />
  );
}

export function cellPropsFor(
  cell: {
    column: {
      id: string;
      getSize: () => number;
      columnDef: { minSize?: number; meta?: unknown };
    };
  },
  leftBorderColor?: Color,
  index?: number,
): {
  textAlign: "left" | "right";
  width: string | undefined;
  minWidth: string;
  borderLeftWidth?: string;
  borderLeftColor?: Color;
} {
  const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
  const size = cell.column.getSize();
  return {
    textAlign: meta?.align ?? "left",
    width: meta?.flex ? undefined : `${size}px`,
    minWidth: `${cell.column.columnDef.minSize ?? 0}px`,
    ...(index === 0 && leftBorderColor
      ? { borderLeftWidth: "2px", borderLeftColor: leftBorderColor }
      : {}),
  };
}
