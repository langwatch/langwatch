import { Button, HStack, Icon, type SystemStyleObject } from "@chakra-ui/react";
import { flexRender, type Header, type Table } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import type React from "react";
import { Table as TableEl, Th, Thead, Tr } from "./TablePrimitives";

type Color = NonNullable<SystemStyleObject["color"]>;

export interface ColumnMeta {
  align?: "left" | "right";
  flex?: boolean;
  /** Number of shimmer bars the skeleton should render for this column. */
  skeletonLines?: number;
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
            {headerGroup.headers.map((header, i) => (
              <HeaderCell
                key={header.id}
                header={header}
                isStickyFirst={stickyFirstColumn && i === 0}
              />
            ))}
          </Tr>
        ))}
      </Thead>
      {children}
    </TableEl>
  );
}

interface HeaderCellProps<T> {
  header: Header<T, unknown>;
  isStickyFirst: boolean;
}

function HeaderCell<T>({
  header,
  isStickyFirst,
}: HeaderCellProps<T>): React.ReactElement {
  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
  const size = header.column.getSize();
  const align = meta?.align ?? "left";
  const canSort = header.column.getCanSort();
  const sortDirection = header.column.getIsSorted();

  return (
    <Th
      width={meta?.flex ? undefined : `${size}px`}
      minWidth={`${header.column.columnDef.minSize}px`}
      textAlign={align}
      fontSize="10px"
      fontWeight="500"
      color="fg.subtle/70"
      textTransform="uppercase"
      letterSpacing="0.06em"
      whiteSpace="nowrap"
      transition="none"
      position={isStickyFirst ? "sticky" : "relative"}
      left={isStickyFirst ? 0 : undefined}
      zIndex={isStickyFirst ? 3 : undefined}
      bg={isStickyFirst ? "bg.surface" : undefined}
    >
      {canSort ? (
        <SortableHeaderButton
          align={align}
          sortDirection={sortDirection}
          onToggle={header.column.getToggleSortingHandler()}
        >
          {flexRender(header.column.columnDef.header, header.getContext())}
        </SortableHeaderButton>
      ) : (
        flexRender(header.column.columnDef.header, header.getContext())
      )}
    </Th>
  );
}

interface SortableHeaderButtonProps {
  align: "left" | "right";
  sortDirection: false | "asc" | "desc";
  onToggle: ((event: unknown) => void) | undefined;
  children: React.ReactNode;
}

function SortableHeaderButton({
  align,
  sortDirection,
  onToggle,
  children,
}: SortableHeaderButtonProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      width="full"
      height="auto"
      minHeight="unset"
      paddingX={2}
      paddingY={1}
      justifyContent={align === "right" ? "flex-end" : "flex-start"}
      color="inherit"
      userSelect="none"
      fontSize="inherit"
      fontWeight="inherit"
      letterSpacing="inherit"
      textTransform="inherit"
      bg="transparent"
      onClick={onToggle}
      _hover={{ color: "fg", bg: "transparent" }}
      _active={{ bg: "transparent" }}
      _focusVisible={{ bg: "transparent" }}
    >
      <HStack gap={0.5}>
        {children}
        <Icon
          boxSize="12px"
          color="blue.fg"
          visibility={sortDirection ? "visible" : "hidden"}
        >
          {sortDirection === "desc" ? <ChevronDown /> : <ChevronUp />}
        </Icon>
      </HStack>
    </Button>
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
