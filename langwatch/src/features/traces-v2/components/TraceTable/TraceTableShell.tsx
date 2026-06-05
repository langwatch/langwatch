import {
  Box,
  Button,
  HStack,
  Icon,
  type SystemStyleObject,
} from "@chakra-ui/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { flexRender, type Header, type Table } from "@tanstack/react-table";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type React from "react";
import {
  COLUMN_DRAG_THRESHOLD_PX,
  useColumnEducationStore,
} from "../../stores/columnEducationStore";
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
  /**
   * Fired when the user drags a column header to reorder. Receives the
   * full ordered list of column ids (excluding any pinned-first
   * select-checkbox column). Callers persist this to the active lens.
   * When omitted, column headers render without a drag handle and the
   * row is not wrapped in a DndContext — preserving the previous
   * behaviour for tables that don't yet support reorder.
   */
  onColumnReorder?: (orderedIds: string[]) => void;
  /**
   * Column ids that must NOT participate in drag-reorder (typically
   * the row-select checkbox at index 0). Reordering operates only on
   * ids outside this set.
   */
  pinnedColumnIds?: ReadonlySet<string>;
}

export function TraceTableShell<T>({
  table,
  minWidth,
  children,
  stickyFirstColumn = false,
  onColumnReorder,
  pinnedColumnIds,
}: TraceTableShellProps<T>): React.ReactElement {
  // Drag-reorder requires the parent to opt-in via onColumnReorder.
  // When opted in we build the list of reorderable header ids (the
  // SortableContext items) and wrap the header row in a DndContext so
  // any header can be dragged into a new slot. Without it the header
  // row renders exactly as before.
  const reorderable = !!onColumnReorder;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Same activation distance the sidebar uses — small enough that
      // intent is unambiguous, large enough that a sloppy click on the
      // grip doesn't kick off a drag.
      activationConstraint: { distance: 5 },
    }),
  );
  const sortableHeaderIds = table
    .getHeaderGroups()[0]
    ?.headers
    .map((h) => h.id)
    .filter((id) => !pinnedColumnIds?.has(id)) ?? [];

  const handleDragEnd = (event: DragEndEvent) => {
    if (!onColumnReorder) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sortableHeaderIds;
    const fromIdx = ids.indexOf(String(active.id));
    const toIdx = ids.indexOf(String(over.id));
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    onColumnReorder(next);
  };

  return (
    <TableEl
      width="full"
      css={{
        // `separate` + `border-spacing: 0` keeps the visual look of a
        // single-pixel grid (no gaps between cells) while letting each
        // TH/TD render its OWN borders — under `collapse` adjacent
        // borders are merged and the head's vertical separators were
        // being absorbed by the body cells below, so the head looked
        // borderless even though we set borderRight on every TH. With
        // `separate` each TH paints its own right edge cleanly.
        borderCollapse: "separate",
        borderSpacing: 0,
        tableLayout: "fixed",
        minWidth,
        position: "relative",
        zIndex: 1,
        ...(stickyFirstColumn && {
          // Pin every body row's leftmost cell during horizontal scroll
          // so the row-select checkbox stays reachable. The TH side is
          // handled in HeaderCell via `isStickyFirst`; this rule covers
          // the corresponding body cells. The bg is scoped by the
          // tbody's `data-row-variant` attribute (set on every
          // StatusRowGroup) so error / warning rows still paint their
          // tint on the sticky cell — without the variant scoping the
          // checkbox column read as a permanently-neutral strip on
          // erroring rows, hiding the status colour the rest of the
          // row was carrying.
          "& tbody > tr > td:first-child": {
            position: "sticky",
            left: 0,
            zIndex: 1,
          },
          // Default rows: the sticky checkbox cell was painting
          // `bg-panel` while the row body is `transparent` (showing
          // the parent's `bg.surface`). In dark mode those two tokens
          // resolve to two distinct shades, which gave each row three
          // visually-distinct horizontal bands (sticky cell / main
          // row body / IO-preview addon). Use `bg.surface` so the
          // sticky cell paints the SAME surface that's behind the
          // transparent row body. Still opaque, still covers any
          // horizontally-scrolled content underneath it.
          "& tbody[data-row-variant='default'] > tr > td:first-child, & tbody:not([data-row-variant]) > tr > td:first-child": {
            backgroundColor: "var(--chakra-colors-bg-surface)",
          },
          // Default-row hover variant for the sticky cell. Mirrors the
          // `style.hoverBg = gray.subtle` painted on the main row's Tr
          // (see RegistryRow). Without this rule, only the row body
          // picked up the hover tint and the sticky cell kept its
          // resting bg — the row read as "half hovered".
          "& tbody[data-row-variant='default']:hover > tr > td:first-child, & tbody:not([data-row-variant]):hover > tr > td:first-child": {
            backgroundColor: "var(--chakra-colors-gray-subtle)",
          },
          "& tbody[data-row-variant='selected'] > tr > td:first-child": {
            backgroundColor: "var(--chakra-colors-blue-subtle)",
          },
          "& tbody[data-row-variant='error'] > tr > td:first-child": {
            // Match RegistryRow's `bg=red.fg/8` so the sticky cell reads
            // as part of the same red surface the rest of the row paints.
            backgroundColor: "color-mix(in srgb, var(--chakra-colors-red-fg) 8%, var(--chakra-colors-bg-panel))",
          },
          "& tbody[data-row-variant='warning'] > tr > td:first-child": {
            backgroundColor: "color-mix(in srgb, var(--chakra-colors-yellow-fg) 8%, var(--chakra-colors-bg-panel))",
          },
          "& tbody[data-row-variant='error']:hover > tr > td:first-child": {
            backgroundColor: "color-mix(in srgb, var(--chakra-colors-red-fg) 14%, var(--chakra-colors-bg-panel))",
          },
          "& tbody[data-row-variant='warning']:hover > tr > td:first-child": {
            backgroundColor: "color-mix(in srgb, var(--chakra-colors-yellow-fg) 14%, var(--chakra-colors-bg-panel))",
          },
        }),
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
        {reorderable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortableHeaderIds}
              strategy={horizontalListSortingStrategy}
            >
              {table.getHeaderGroups().map((headerGroup) => (
                <Tr key={headerGroup.id} borderBottomWidth="0">
                  {headerGroup.headers.map((header, i) => (
                    <HeaderCell
                      key={header.id}
                      header={header}
                      isStickyFirst={stickyFirstColumn && i === 0}
                      reorderable={!pinnedColumnIds?.has(header.id)}
                    />
                  ))}
                </Tr>
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          table.getHeaderGroups().map((headerGroup) => (
            <Tr key={headerGroup.id} borderBottomWidth="0">
              {headerGroup.headers.map((header, i) => (
                <HeaderCell
                  key={header.id}
                  header={header}
                  isStickyFirst={stickyFirstColumn && i === 0}
                />
              ))}
            </Tr>
          ))
        )}
      </Thead>
      {children}
    </TableEl>
  );
}

interface HeaderCellProps<T> {
  header: Header<T, unknown>;
  isStickyFirst: boolean;
  /**
   * When true, the header cell is a sortable item — it picks up a
   * drag-handle icon at the left of the title and registers with the
   * surrounding SortableContext. False (the default) means the
   * column is pinned in its current position (the row-select
   * checkbox column uses this).
   */
  reorderable?: boolean;
}

function HeaderCell<T>({
  header,
  isStickyFirst,
  reorderable = false,
}: HeaderCellProps<T>): React.ReactElement {
  // Conditional `useSortable` — same hooks-discipline-friendly pattern
  // the sidebar uses for SortableSection. We always call the hook so
  // its call order is stable; the returned props are simply unused
  // when `reorderable` is false.
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: header.id, disabled: !reorderable });
  const dragHandleProps = (reorderable
    ? { ...attributes, ...(listeners ?? {}) }
    : {}) as React.HTMLAttributes<HTMLElement>;
  const meta = header.column.columnDef.meta as ColumnMeta | undefined;
  // Open the one-off education dialog the first time the user tries
  // to drag a header to reorder it. v2 doesn't support native drag-
  // reorder (yet), so without the dialog the drag attempt silently
  // does nothing and operators walk away thinking "you can't change
  // the columns" — they can, just from the Columns dropdown / floating
  // Configure CTA, which the dialog points at. After the user
  // dismisses with "Don't show again", `hasDismissed` in
  // `columnEducationStore` flips true and the handler short-circuits.
  const openEducation = useColumnEducationStore((s) => s.open);
  const educationDismissed = useColumnEducationStore((s) => s.hasDismissed);
  const onHeaderMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (educationDismissed) return;
    // Skip drags that originate on the resize grip (legitimate sizing
    // gesture) OR on the drag-reorder grip (legitimate reorder
    // gesture) — surfacing the education dialog from either of those
    // would be infuriating now that both paths work.
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-column-resize-grip]")) return;
    if (target?.closest("[data-column-drag-handle]")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy >= COLUMN_DRAG_THRESHOLD_PX ** 2) {
        openEducation();
        cleanup();
      }
    };
    const onUp = () => cleanup();
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  const onHeaderDoubleClick = () => {
    // Double-click is the other common "I'm trying to do something to
    // this header" gesture — treat it the same as a drag attempt for
    // the education path so users who instinctively double-tap also
    // see the dialog.
    if (educationDismissed) return;
    openEducation();
  };
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
      ref={reorderable ? setNodeRef : undefined}
      // Apply ONLY the translation from the sortable transform —
      // `CSS.Translate.toString` skips the scaleX/scaleY that
      // horizontalListSortingStrategy bakes in to fit the source's
      // visual box to the target slot's width. With variable-width
      // columns (Time = 60px vs Trace = 400px), the scale was producing
      // grotesque stretches as the user dragged a narrow column over a
      // wide one. Translation alone keeps the source at its natural
      // width while still tracking the pointer.
      style={
        reorderable
          ? {
              transform: CSS.Translate.toString(transform),
              transition,
              opacity: isDragging ? 0.6 : 1,
            }
          : undefined
      }
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
      // Th-scoped CSS reveals the drag grip on hover. `_groupHover` via
      // `role="group"` was unreliable across our chakra("th") wrapper —
      // the raw `&:hover` descendant selector is simpler and works
      // regardless of how the parent's group plumbing resolves.
      css={{
        "& [data-column-drag-handle]": {
          opacity: 0,
          transition: "opacity 100ms ease",
        },
        "&:hover [data-column-drag-handle], & [data-column-drag-handle]:focus-visible":
          {
            opacity: 1,
          },
      }}
      position={isStickyFirst ? "sticky" : "relative"}
      left={isStickyFirst ? 0 : undefined}
      zIndex={isStickyFirst ? 3 : isDragging ? 4 : undefined}
      bg={
        isActiveSort
          ? { base: "bg.muted", _dark: "bg.muted" }
          : isStickyFirst
            ? { base: "bg.subtle", _dark: "bg.surface" }
            : undefined
      }
      // Vertical separator between TH cells + bottom border to
      // separate the head from the body rows. Under
      // `border-collapse: separate` both edges paint cleanly per cell
      // (the TR-level border was being swallowed). One step lighter
      // than `gray.300/gray.700` since `separate` mode renders the
      // border at full strength without sharing pixels with the body
      // cell below — the previous step looked too heavy once the
      // collapse merging stopped.
      borderRightWidth="1px"
      borderRightColor={{ base: "gray.200", _dark: "gray.800" }}
      borderBottomWidth="1px"
      borderBottomColor={{ base: "gray.200", _dark: "gray.800" }}
      // Unified padding for every header — sortable + non-sortable share the
      // same Th paddings so the column titles line up across the row. The
      // sortable button below is `width: full` and only adds its own
      // background on hover, so it slots inside this padding rather than
      // replacing it.
      paddingX={2}
      paddingY={1}
      onMouseDown={onHeaderMouseDown}
      onDoubleClick={onHeaderDoubleClick}
    >
      {reorderable && (
        // Drag handle floats on the cell's left edge, hidden until the
        // user hovers (or focuses) the header. The header label/sort
        // chrome owns the cell's full width so labels like "TIME" no
        // longer get squeezed by a permanently-rendered grip — the grip
        // appears only when the operator is reaching for it. On hover
        // it sits over the leftmost few pixels of the label; on a
        // narrow column the label dims behind it, which is fine since
        // the user is actively about to drag the column.
        // GripVertical (vertical-dot orientation) reads as the "grab to
        // move horizontally" gesture, matching every other table
        // reorder UI users have seen.
        <Box
          data-column-drag-handle="true"
          position="absolute"
          top="50%"
          left="2px"
          transform="translateY(-50%)"
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          width="14px"
          height="14px"
          color="fg.subtle"
          cursor="grab"
          // Opacity is controlled by the Th-scoped CSS above; keyboard
          // focus also reveals the handle via the `:focus-visible`
          // selector. We still paint a focus ring locally for the
          // keyboard path so the handle is unambiguously the focused
          // element.
          _focusVisible={{
            outline: "2px solid",
            outlineColor: "blue.focusRing",
            outlineOffset: "1px",
            borderRadius: "sm",
          }}
          _active={{ cursor: "grabbing" }}
          // Backdrop so the grip stays legible when overlaying short
          // labels in narrow columns. Picks up the active-sort tint
          // so it doesn't clash with the cell's own background.
          bg={
            isActiveSort
              ? { base: "bg.muted", _dark: "bg.muted" }
              : { base: "bg.subtle/85", _dark: "bg.surface/85" }
          }
          borderRadius="sm"
          zIndex={1}
          aria-label="Drag to reorder column"
          title="Drag to reorder column"
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          <Icon boxSize="10px">
            <GripVertical />
          </Icon>
        </Box>
      )}
      <Box flex={1} minWidth={0}>
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
      </Box>
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
  rightBorderColor?: Color,
): {
  textAlign: "left" | "right";
  width: string | undefined;
  minWidth: string;
  borderLeftWidth?: string;
  borderLeftColor?: Color;
  borderRightWidth: string;
  borderRightColor?: Color;
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
    // No vertical separators on body cells — the table head owns the
    // column boundaries via its own TH borders. Operator feedback:
    // body-row verticals added visual noise on the white surface and
    // made error rows even busier than they needed to be. Caller can
    // pass `rightBorderColor` to opt a specific cell back into a
    // separator if needed.
    borderRightWidth: rightBorderColor ? "1px" : "0",
    borderRightColor: rightBorderColor ?? undefined,
    ...(index === 0 && leftBorderColor
      ? { borderLeftWidth: "2px", borderLeftColor: leftBorderColor }
      : {}),
  };
}
