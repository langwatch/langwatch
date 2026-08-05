import { chakra, HStack, Icon, Input, Stack, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { Checkbox } from "../../../../components/ui/checkbox";
import { toaster } from "../../../../components/ui/toaster";
import { useEvaluatorOptions } from "../../hooks/useEvaluatorOptions";
import {
  LENS_CAPABILITIES,
  type LensColumnOption,
} from "../../lens/capabilities";
import { isEvalColumnId, parseEvalColumnId } from "../../lens/evalColumnId";
import {
  type TimeColumnFormat,
  useTimeFormatStore,
} from "../../stores/timeFormatStore";
import { useViewStore } from "../../stores/viewStore";
import { evalColumnLabel } from "../TraceTable/evalColumns";
import {
  AddEvalColumnForm,
  COLUMN_APPENDED_HINT,
} from "./columnPicker/AddEvalColumnForm";
import { VisibleOrderStrip } from "./columnPicker/VisibleOrderStrip";

const SECTION_ORDER = ["Standard", "Trace fields", "Evaluations", "Events"];

const TIME_FORMAT_OPTIONS: { value: TimeColumnFormat; label: string }[] = [
  { value: "relative", label: "Relative" },
  { value: "iso", label: "ISO" },
];

/**
 * The column picker body — shared by the toolbar Columns button and the
 * trailing "+" column header. A "Visible order" reorder strip, the column
 * toggles grouped by section, and an "Add custom column" section at the
 * bottom for per-evaluator eval columns. No column is pinned: every column
 * can be toggled and reordered here, matching the table header.
 */
export const ColumnPickerContent: React.FC = () => {
  const columnOrder = useViewStore((s) => s.columnOrder);
  const toggleColumn = useViewStore((s) => s.toggleColumn);
  const reorderColumns = useViewStore((s) => s.reorderColumns);
  const grouping = useViewStore((s) => s.grouping);
  const { options: evaluatorOptions, nameByKey } = useEvaluatorOptions();
  const [query, setQuery] = useState("");

  const isTraceGrouping = grouping === "flat";
  const capability = LENS_CAPABILITIES[grouping];

  // Per-evaluator eval columns are dynamic (not in the static capability
  // list); derive their option entries from the active columnOrder so they
  // render as toggles + in the reorder strip with resolved labels.
  const evalColumnOptions = useMemo<LensColumnOption[]>(() => {
    if (!isTraceGrouping) return [];
    return columnOrder.filter(isEvalColumnId).flatMap((id) => {
      const parsed = parseEvalColumnId(id);
      if (!parsed) return [];
      return [
        {
          id,
          label: evalColumnLabel({
            field: parsed.field,
            evaluatorKey: parsed.evaluatorKey,
            evaluatorNames: nameByKey,
          }),
          section: "Evaluations",
        },
      ];
    });
  }, [isTraceGrouping, columnOrder, nameByKey]);

  const allColumns = useMemo(
    () => [...capability.columns, ...evalColumnOptions],
    [capability.columns, evalColumnOptions],
  );
  const columnById = useMemo(
    () => new Map(allColumns.map((c) => [c.id, c])),
    [allColumns],
  );
  const isVisible = (id: string) => columnOrder.includes(id);

  const handleToggle = (column: LensColumnOption) => {
    const wasVisible = isVisible(column.id);
    toggleColumn(column.id);
    if (!wasVisible) {
      toaster.create({
        title: `Added "${column.label}"`,
        description: COLUMN_APPENDED_HINT,
        type: "info",
        duration: 3500,
      });
    }
  };

  // Every visible column is reorderable now — drives the reorder strip.
  const orderedVisibleColumns = columnOrder
    .map((id) => columnById.get(id))
    .filter((c): c is LensColumnOption => !!c);

  const q = query.trim().toLowerCase();
  const sections = useMemo(() => {
    const grouped = groupBySection(allColumns);
    if (!q) return grouped;
    return grouped
      .map((s) => ({
        ...s,
        columns: s.columns.filter((c) => c.label.toLowerCase().includes(q)),
      }))
      .filter((s) => s.columns.length > 0);
  }, [allColumns, q]);

  return (
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
          {orderedVisibleColumns.length} shown
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

      {orderedVisibleColumns.length > 1 && !q && (
        <Stack gap={0.5}>
          <SectionLabel>Visible order</SectionLabel>
          <VisibleOrderStrip
            columns={orderedVisibleColumns}
            columnOrder={columnOrder}
            reorderColumns={reorderColumns}
            onRemove={(id) => toggleColumn(id)}
          />
        </Stack>
      )}

      {sections.map(({ title, columns }) => (
        <Stack key={title} gap={1}>
          <SectionLabel>{title}</SectionLabel>
          <Stack gap={0}>
            {columns.map((column) =>
              column.id === "time" ? (
                <TimeColumnRow
                  key={column.id}
                  column={column}
                  checked={isVisible(column.id)}
                  onToggle={() => handleToggle(column)}
                />
              ) : (
                <ColumnCheckbox
                  key={column.id}
                  column={column}
                  checked={isVisible(column.id)}
                  onToggle={() => handleToggle(column)}
                />
              ),
            )}
          </Stack>
        </Stack>
      ))}

      {isTraceGrouping && (
        <Stack gap={1}>
          <SectionLabel>Add custom column</SectionLabel>
          <AddEvalColumnForm
            evaluatorOptions={evaluatorOptions}
            nameByKey={nameByKey}
            columnOrder={columnOrder}
            onToggle={toggleColumn}
          />
        </Stack>
      )}
    </Stack>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Text
    textStyle="2xs"
    fontWeight="semibold"
    color="fg.muted"
    textTransform="uppercase"
    letterSpacing="0.06em"
  >
    {children}
  </Text>
);

const ColumnCheckbox: React.FC<{
  column: LensColumnOption;
  checked: boolean;
  onToggle: () => void;
}> = ({ column, checked, onToggle }) => (
  <Checkbox size="sm" checked={checked} paddingY={1} onCheckedChange={onToggle}>
    <Text textStyle="xs" color="fg">
      {column.label}
    </Text>
  </Checkbox>
);

/**
 * The Time column's row carries the visibility checkbox plus a Relative /
 * ISO format toggle for how the column renders its timestamps.
 */
const TimeColumnRow: React.FC<{
  column: LensColumnOption;
  checked: boolean;
  onToggle: () => void;
}> = ({ column, checked, onToggle }) => {
  const format = useTimeFormatStore((s) => s.format);
  const setFormat = useTimeFormatStore((s) => s.setFormat);
  return (
    <HStack justify="space-between" gap={2} paddingY={1}>
      <Checkbox size="sm" checked={checked} onCheckedChange={onToggle}>
        <Text textStyle="xs" color="fg">
          {column.label}
        </Text>
      </Checkbox>
      <HStack
        gap={0}
        flexShrink={0}
        borderWidth="1px"
        borderColor="border"
        borderRadius="sm"
        overflow="hidden"
      >
        {TIME_FORMAT_OPTIONS.map((o) => {
          const active = format === o.value;
          return (
            <chakra.button
              type="button"
              key={o.value}
              aria-pressed={active}
              onClick={() => setFormat(o.value)}
              paddingX={1.5}
              paddingY={0.5}
              textStyle="2xs"
              fontWeight="medium"
              cursor="pointer"
              bg={active ? "bg.emphasized" : "transparent"}
              color={active ? "fg" : "fg.subtle"}
              _hover={active ? undefined : { color: "fg", bg: "bg.muted" }}
            >
              {o.label}
            </chakra.button>
          );
        })}
      </HStack>
    </HStack>
  );
};

function groupBySection(
  columns: readonly LensColumnOption[],
): Array<{ title: string; columns: LensColumnOption[] }> {
  const byTitle = new Map<string, LensColumnOption[]>();
  for (const c of columns) {
    const title = c.section ?? "Other";
    const bucket = byTitle.get(title) ?? [];
    bucket.push(c);
    byTitle.set(title, bucket);
  }
  return [...byTitle.entries()]
    .map(([title, cols]) => ({ title, columns: cols }))
    .sort((a, b) => {
      const ai = SECTION_ORDER.indexOf(a.title);
      const bi = SECTION_ORDER.indexOf(b.title);
      if (ai === -1 && bi === -1) return a.title.localeCompare(b.title);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
}
