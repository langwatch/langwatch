import { Button, Icon, Table } from "@chakra-ui/react";
import { ChevronDown, ChevronUp } from "lucide-react";

import type { ColumnSortState } from "./columnSort";

/**
 * A heading that sorts, drawn the way the trace table draws one: the column in
 * force reads as the one in charge, with a tinted band, a darker label and a
 * chevron pointing the way it is ordered. Every other sortable column keeps a
 * faint chevron so a reader can tell at a glance which headings do something,
 * without hovering each one to find out.
 *
 * `aria-sort` on the header says the same thing to a reader who cannot see the
 * chevron: without it someone could sort the table by keyboard and have no way
 * to learn that they had.
 */
/**
 * The chevron: solid and pointing the way the column is ordered when it is the
 * one in force, faint and downward on every other sortable column so a reader
 * can tell which headings do something without hovering each one.
 */
function SortIndicator({ direction }: { direction: "asc" | "desc" | null }) {
  if (direction === null) {
    return (
      <Icon
        data-sort-hint
        boxSize="12px"
        color="fg.muted"
        opacity={0.35}
        flexShrink={0}
        transition="opacity 0.1s ease"
      >
        <ChevronDown />
      </Icon>
    );
  }
  return (
    <Icon boxSize="12px" color="fg" flexShrink={0}>
      {direction === "asc" ? <ChevronUp /> : <ChevronDown />}
    </Icon>
  );
}

/** What `aria-sort` has to say for a reader who cannot see the chevron. */
function ariaSortFor(direction: "asc" | "desc" | null) {
  if (direction === null) return "none" as const;
  return direction === "asc" ? ("ascending" as const) : ("descending" as const);
}

export function SortableColumnHeader<Column extends string>({
  label,
  column,
  sort,
  onSort,
  align = "start",
}: {
  label: string;
  column: Column;
  sort: ColumnSortState<Column>;
  onSort: (column: Column) => void;
  align?: "start" | "end";
}) {
  const active = sort.column === column;
  const direction = active ? sort.direction : null;

  return (
    <Table.ColumnHeader
      aria-sort={ariaSortFor(direction)}
      // The band and the darker label do the highlighting. Weight is left to
      // the table's own heading style, which is already bold: overriding it
      // here made the sorted column read LIGHTER than the rest.
      bg={active ? "bg.muted" : undefined}
      color={active ? "fg" : undefined}
    >
      <Button
        type="button"
        variant="plain"
        aria-label={`Sort by ${label}`}
        onClick={() => onSort(column)}
        width="full"
        height="auto"
        minHeight="unset"
        paddingX={0}
        paddingY={0}
        gap={1}
        // The right-aligned columns keep their label pinned to the edge, so it
        // does not shift sideways when the chevron changes.
        justifyContent={align === "end" ? "flex-end" : "flex-start"}
        // The header band owns the type; the button only carries the click.
        color="inherit"
        fontSize="inherit"
        fontWeight="inherit"
        letterSpacing="inherit"
        textTransform="inherit"
        userSelect="none"
        _hover={{ color: "fg" }}
        css={{ "&:hover [data-sort-hint]": { opacity: 0.85 } }}
      >
        {label}
        <SortIndicator direction={direction} />
      </Button>
    </Table.ColumnHeader>
  );
}
