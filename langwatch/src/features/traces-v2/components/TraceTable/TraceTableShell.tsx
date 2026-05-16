import {
  Box,
  Button,
  HStack,
  Icon,
  type SystemStyleObject,
} from "@chakra-ui/react";
import { flexRender, type Header, type Table } from "@tanstack/react-table";
import { ChevronDown, ChevronUp } from "lucide-react";
import type React from "react";
import { ColumnResizeGrip } from "./ColumnResizeGrip";
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
        tableLayout: "fixed",
        minWidth,
        position: "relative",
        zIndex: 1,
      }}
    >
      {/*
        Light mode: the header row reads as a soft elevation against
        the white table body — `bg.subtle` is lighter than the
        previous `bg.muted`, which felt too dark per operator feedback.
        Dark mode keeps the existing slight elevation token.
      */}
      <Thead
        position="sticky"
        top={0}
        zIndex={2}
        bg={{ base: "bg.subtle", _dark: "bg.surface" }}
      >
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
  const declaredSize = header.column.columnDef.size;
  // Flex columns declare a sentinel `size` (9999) to absorb leftover
  // space — those normally render with `width: undefined` so the
  // browser flexes them to fill the table. Once the user manually
  // resizes one (TanStack writes the resolved px width into
  // columnSizing → `getSize()` no longer matches the sentinel) we
  // switch to a fixed `${size}px` so the resize actually sticks.
  // Without this, dragging the trace column's grip updated state but
  // visually nothing happened because `width` stayed undefined.
  const isFlex = meta?.flex;
  const wasResized = isFlex && declaredSize !== undefined && size !== declaredSize;
  const useFixedWidth = !isFlex || wasResized;
  const align = meta?.align ?? "left";
  const canSort = header.column.getCanSort();
  const sortDirection = header.column.getIsSorted();
  const isActiveSort = sortDirection !== false;

  return (
    <Th
      width={useFixedWidth ? `${size}px` : undefined}
      minWidth={`${header.column.columnDef.minSize}px`}
      // Clip header text at the cell boundary so labels like
      // "DURATION" don't visually overflow when the column is sized
      // narrow. Inner SortableHeaderButton handles ellipsis on the
      // label itself; this is the belt-and-suspenders clip.
      overflow="hidden"
      textAlign={align}
      textStyle="2xs"
      fontWeight={isActiveSort ? "600" : "500"}
      color={isActiveSort ? "fg" : "fg.muted"}
      textTransform="uppercase"
      letterSpacing="0.06em"
      whiteSpace="nowrap"
      transition="none"
      position={isStickyFirst ? "sticky" : "relative"}
      left={isStickyFirst ? 0 : undefined}
      zIndex={isStickyFirst ? 3 : undefined}
      bg={
        isActiveSort
          ? { base: "bg.muted", _dark: "bg.muted" }
          : isStickyFirst
            ? { base: "bg.subtle", _dark: "bg.surface" }
            : undefined
      }
      // Visible 1px vertical separator between TH cells. `border.muted`
      // sits between `border.subtle` (too faint to see on the new
      // lighter header bg) and `border` (too loud against the gray).
      borderRightWidth="1px"
      borderRightColor="border.muted"
      // Unified padding for every header — sortable + non-sortable share the
      // same Th paddings so the column titles line up across the row. The
      // sortable button below is `width: full` and only adds its own
      // background on hover, so it slots inside this padding rather than
      // replacing it.
      paddingX={2}
      paddingY={1}
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
      <ColumnResizeGrip header={header} />
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
  const isActive = sortDirection !== false;
  return (
    <Button
      type="button"
      variant="ghost"
      width="full"
      height="auto"
      minHeight="unset"
      // No additional padding — the parent `Th` owns the padding so sortable
      // and non-sortable headers line up to the same grid.
      paddingX={0}
      paddingY={0}
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
      role="group"
    >
      <HStack gap={1} minWidth={0} flex={1}>
        <Box truncate flex={1} minWidth={0} textAlign={align}>
          {children}
        </Box>
        {isActive ? (
          <Icon boxSize="12px" color="fg" flexShrink={0}>
            {sortDirection === "desc" ? <ChevronDown /> : <ChevronUp />}
          </Icon>
        ) : (
          // Inactive sortable columns show a faint chevron at all times so
          // users can tell at a glance which columns are sortable without
          // having to hover each one. Hover lifts it to make the click
          // target obvious. Previously the chevron only appeared on hover,
          // which made sortable and non-sortable headers visually
          // identical and led to surprise no-ops on click.
          <Icon
            boxSize="12px"
            color="fg.muted"
            opacity={0.35}
            flexShrink={0}
            _groupHover={{ opacity: 0.85 }}
            transition="opacity 0.1s ease"
          >
            <ChevronDown />
          </Icon>
        )}
      </HStack>
    </Button>
  );
}

export function cellPropsFor(
  cell: {
    column: {
      id: string;
      getSize: () => number;
      columnDef: { size?: number; minSize?: number; meta?: unknown };
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
  borderRightWidth: string;
  borderRightColor: Color;
} {
  const meta = cell.column.columnDef.meta as ColumnMeta | undefined;
  const size = cell.column.getSize();
  const declaredSize = cell.column.columnDef.size;
  // Flex cells follow the same rule as the header: undefined width
  // when the column is still in its "absorb leftover space" state,
  // fixed px width once the user has explicitly resized it. Keeping
  // header + body in lockstep on this is what makes the resize grip
  // affect the visible cell width.
  const isFlex = meta?.flex;
  const wasResized =
    isFlex && declaredSize !== undefined && size !== declaredSize;
  const useFixedWidth = !isFlex || wasResized;
  return {
    textAlign: meta?.align ?? "left",
    width: useFixedWidth ? `${size}px` : undefined,
    minWidth: `${cell.column.columnDef.minSize ?? 0}px`,
    borderRightWidth: "1px",
    borderRightColor: "border.subtle",
    ...(index === 0 && leftBorderColor
      ? { borderLeftWidth: "2px", borderLeftColor: leftBorderColor }
      : {}),
  };
}
