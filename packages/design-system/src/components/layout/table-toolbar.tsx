import { Button, Flex, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { SearchInput } from "../forms/search-input.tsx";
import { ColumnPicker, type ColumnPickerProps } from "./column-picker.tsx";
import { SelectionActionBar, type SelectionActionBarProps } from "./selection-action-bar.tsx";

export interface ListPageSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The search box's accessible name. */
  ariaLabel: string;
  testId?: string;
}

export interface TableToolbarProps {
  /** Narrows the list; the caller debounces. */
  search?: ListPageSearch;
  /** A distinct input that tests a value against the rows; not a second search. */
  lookup?: ListPageSearch;
  /** FilterChips, a scope picker, a segmented control or a select: design-system elements only. */
  filters?: ReactNode;
  columns?: ColumnPickerProps;
  /** "12 of 40 models". */
  summary?: string;
  /** Pass only while a filter is active; draws "Clear filters". */
  onClearFilters?: () => void;
  /** Right end: a period control, an Export button. */
  actions?: ReactNode;
  /** The bar for the current selection, drawn inline as the first band. */
  selection?: Omit<SelectionActionBarProps, "placement">;
  /** Loading: the search inputs are disabled. */
  disabled?: boolean;
  /** Inside a Card with no padding: 16px inset and a bottom hairline. */
  attached?: boolean;
}

const INPUT = { flex: "1 1 12rem", maxWidth: "20rem" } as const;

function ToolbarSearch({ field, disabled }: { field: ListPageSearch; disabled: boolean }) {
  return (
    <SearchInput
      value={field.value}
      onChange={(event) => field.onChange(event.target.value)}
      placeholder={field.placeholder}
      aria-label={field.ariaLabel}
      data-testid={field.testId}
      disabled={disabled}
      containerProps={INPUT}
    />
  );
}

/**
 * The one toolbar row above a table: search, lookup, filters and summary on the left; columns
 * and actions on the right; wraps, never two toolbars. `ListPage` draws it from its `toolbar`.
 */
export function TableToolbar({
  search,
  lookup,
  filters,
  columns,
  summary,
  onClearFilters,
  actions,
  selection,
  disabled = false,
  attached = false,
}: TableToolbarProps) {
  const hasRow = search || lookup || filters || columns || summary || onClearFilters || actions;
  if (!hasRow && !selection) return null;
  return (
    <Flex
      direction="column"
      gap={2}
      minWidth={0}
      data-table-toolbar=""
      {...(attached
        ? { padding: 4, borderBottomWidth: "1px", borderBottomColor: "border.muted" }
        : {})}
    >
      {selection && <SelectionActionBar {...selection} placement="inline" />}
      {hasRow && (
        <Flex wrap="wrap" align="center" gap={3} minWidth={0}>
          {search && <ToolbarSearch field={search} disabled={disabled} />}
          {lookup && <ToolbarSearch field={lookup} disabled={disabled} />}
          {filters}
          {summary && (
            <Text as="output" textStyle="xs" color="fg.muted">
              {summary}
            </Text>
          )}
          {onClearFilters && (
            <Button type="button" variant="plain" size="xs" color="fg" onClick={onClearFilters}>
              Clear filters
            </Button>
          )}
          {(columns || actions) && (
            <Flex align="center" gap={2} marginStart="auto" minWidth={0}>
              {columns && <ColumnPicker {...columns} />}
              {actions}
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}
