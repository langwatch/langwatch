import { Checkbox } from "@langwatch/design-system/checkbox";
import { Popover } from "@langwatch/design-system/popover";
import { Button, HStack, Icon, Input, Stack, Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { TriggerAnchor } from "@langwatch/design-system/trigger-anchor";
import { ChevronDown, Columns3, Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  isColumnVisible,
  type AnnotationColumnChoices,
  type AnnotationColumnOption,
} from "./annotation-columns.ts";

type ColumnVisibleChange = (change: { columnId: string; isVisible: boolean }) => void;

/** Show or hide the list's columns: a search box, grouped by section, with a count shown. */
export function AnnotationColumnsMenu({
  columns,
  choices,
  onColumnVisibleChange,
  onReset,
  hasChoices,
}: {
  columns: AnnotationColumnOption[];
  choices: AnnotationColumnChoices;
  onColumnVisibleChange: ColumnVisibleChange;
  onReset: () => void;
  hasChoices: boolean;
}) {
  const [query, setQuery] = useState("");

  const shownCount = useMemo(
    () => columns.filter((column) => isColumnVisible({ column, choices })).length,
    [columns, choices],
  );

  const sections = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const matching = wanted
      ? columns.filter((column) => column.label.toLowerCase().includes(wanted))
      : columns;
    const bySection = new Map<string, AnnotationColumnOption[]>();
    for (const column of matching) {
      bySection.set(column.section, [...(bySection.get(column.section) ?? []), column]);
    }

    return [...bySection.entries()].map(([title, sectionColumns]) => ({
      title,
      columns: sectionColumns,
    }));
  }, [columns, query]);

  return (
    <Popover.Root positioning={{ placement: "bottom-end" }}>
      <Tooltip content="Show or hide columns" positioning={{ placement: "top" }}>
        {/* Tooltip and Popover.Trigger both clone an id onto the child, so the
            trigger needs its own node or the menu opens at the page corner. */}
        <TriggerAnchor>
          <Popover.Trigger asChild>
            <Button variant="outline" aria-label="Show or hide columns in the table" gap={1}>
              <Columns3 size={16} />
              Columns
              <ChevronDown size={16} />
            </Button>
          </Popover.Trigger>
        </TriggerAnchor>
      </Tooltip>
      <Popover.Content width="auto" padding={0}>
        <Stack width="284px" maxHeight="min(70vh, 520px)" overflowY="auto" gap={2.5} padding={2.5}>
          <HStack justify="space-between" align="baseline">
            <Text textStyle="sm" fontWeight="semibold" color="fg">
              Columns
            </Text>
            <Text textStyle="2xs" color="fg.subtle">
              {shownCount} shown
            </Text>
          </HStack>

          <SearchBox query={query} onQueryChange={setQuery} />

          {sections.map(({ title, columns: sectionColumns }) => (
            <ColumnSection
              key={title}
              title={title}
              columns={sectionColumns}
              choices={choices}
              onColumnVisibleChange={onColumnVisibleChange}
            />
          ))}

          {hasChoices && (
            <Button size="xs" variant="ghost" alignSelf="start" onClick={onReset}>
              Reset to default
            </Button>
          )}
        </Stack>
      </Popover.Content>
    </Popover.Root>
  );
}

function SearchBox({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (query: string) => void;
}) {
  return (
    <HStack
      gap={1.5}
      paddingX={2}
      height="36px"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.subtle"
      _focusWithin={{ borderColor: "border.emphasized" }}
    >
      <Icon color="fg.subtle" boxSize={3.5}>
        <Search />
      </Icon>
      <Input
        size="xs"
        variant="flushed"
        border="none"
        height="full"
        padding={0}
        placeholder="Search columns…"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") event.stopPropagation();
        }}
        _focusVisible={{ boxShadow: "none" }}
      />
    </HStack>
  );
}

function ColumnSection({
  title,
  columns,
  choices,
  onColumnVisibleChange,
}: {
  title: string;
  columns: AnnotationColumnOption[];
  choices: AnnotationColumnChoices;
  onColumnVisibleChange: ColumnVisibleChange;
}) {
  return (
    <Stack gap={1}>
      <Text
        textStyle="2xs"
        fontWeight="semibold"
        color="fg.muted"
        textTransform="uppercase"
        letterSpacing="0.06em"
      >
        {title}
      </Text>
      <Stack gap={0}>
        {columns.map((column) => (
          <Checkbox
            key={column.id}
            size="sm"
            paddingY={1}
            checked={isColumnVisible({ column, choices })}
            onCheckedChange={({ checked }) =>
              onColumnVisibleChange({ columnId: column.id, isVisible: checked === true })
            }
          >
            <Text textStyle="xs" color="fg">
              {column.label}
            </Text>
          </Checkbox>
        ))}
      </Stack>
    </Stack>
  );
}
