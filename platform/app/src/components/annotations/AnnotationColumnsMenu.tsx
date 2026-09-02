import { Button, HStack, Icon, Input, Stack, Text } from "@chakra-ui/react";
import { ChevronDown, Columns3, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "../ui/checkbox";
import { Popover } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import {
  type AnnotationColumnChoices,
  type AnnotationColumnOption,
  isColumnVisible,
} from "./annotationColumns";

/**
 * Show or hide the annotations list's columns, the way the trace explorer's
 * column picker does: a search box over the whole set, grouped by section,
 * with a count of what is showing.
 *
 * Order is the table's own and is not something the reviewer sets here — the
 * list has one sensible reading order, and the complaint this answers was a
 * wall of empty columns, not the order they sat in.
 */
export function AnnotationColumnsMenu({
  columns,
  choices,
  onColumnVisibleChange,
  onReset,
  hasChoices,
}: {
  columns: AnnotationColumnOption[];
  choices: AnnotationColumnChoices;
  onColumnVisibleChange: (change: {
    columnId: string;
    isVisible: boolean;
  }) => void;
  onReset: () => void;
  hasChoices: boolean;
}) {
  const [query, setQuery] = useState("");

  const shownCount = useMemo(
    () =>
      columns.filter((column) => isColumnVisible({ column, choices })).length,
    [columns, choices],
  );

  const sections = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const matching = wanted
      ? columns.filter((column) => column.label.toLowerCase().includes(wanted))
      : columns;
    const bySection = new Map<string, AnnotationColumnOption[]>();
    for (const column of matching) {
      const bucket = bySection.get(column.section) ?? [];
      bucket.push(column);
      bySection.set(column.section, bucket);
    }
    return [...bySection.entries()].map(([title, sectionColumns]) => ({
      title,
      columns: sectionColumns,
    }));
  }, [columns, query]);

  return (
    <Popover.Root positioning={{ placement: "bottom-end" }}>
      <Tooltip
        content="Show or hide columns"
        positioning={{ placement: "top" }}
      >
        <Popover.Trigger asChild>
          <Button
            variant="outline"
            aria-label="Show or hide columns in the table"
            gap={1}
          >
            <Columns3 size={16} />
            Columns
            <ChevronDown size={16} />
          </Button>
        </Popover.Trigger>
      </Tooltip>
      <Popover.Content width="auto" padding={0}>
        <Stack
          width="284px"
          maxHeight="min(70vh, 520px)"
          overflowY="auto"
          gap={2.5}
          padding={2.5}
        >
          <HStack justify="space-between" align="baseline">
            <Text textStyle="sm" fontWeight="semibold" color="fg">
              Columns
            </Text>
            <Text textStyle="2xs" color="fg.subtle">
              {shownCount} shown
            </Text>
          </HStack>

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
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") e.stopPropagation();
              }}
              _focusVisible={{ boxShadow: "none" }}
            />
          </HStack>

          {sections.map(({ title, columns: sectionColumns }) => (
            <Stack key={title} gap={1}>
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
                {sectionColumns.map((column) => (
                  <Checkbox
                    key={column.id}
                    size="sm"
                    paddingY={1}
                    checked={isColumnVisible({ column, choices })}
                    onCheckedChange={({ checked }) =>
                      onColumnVisibleChange({
                        columnId: column.id,
                        isVisible: checked === true,
                      })
                    }
                  >
                    <Text textStyle="xs" color="fg">
                      {column.label}
                    </Text>
                  </Checkbox>
                ))}
              </Stack>
            </Stack>
          ))}

          {hasChoices && (
            <Button
              size="xs"
              variant="ghost"
              alignSelf="start"
              onClick={onReset}
            >
              Reset to default
            </Button>
          )}
        </Stack>
      </Popover.Content>
    </Popover.Root>
  );
}
