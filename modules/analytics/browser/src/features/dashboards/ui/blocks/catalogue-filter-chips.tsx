/**
 * The catalogue's filter chips, one multi-select row each for trunk, agent kind and readiness
 * with "All" and counts, and the label a card or row shows for one chip. The design system's
 * `FilterChips` picks one value; the templates library and the picker both need several.
 */

import { Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Activity, DollarSign, FlaskConical, type LucideIcon, TriangleAlert } from "lucide-react";

import { AGENT_KIND_LABELS, AGENT_KINDS, TRUNKS, type Trunk } from "../../catalogue/index.ts";
import {
  CATALOGUE_STATUS_LABELS,
  CATALOGUE_STATUSES,
  type CatalogueChipCounts,
  type CatalogueFilters,
  togglePicked,
} from "../../model/catalogue-filter.ts";

/** One design-system palette per trunk, for its chip, its labels and its section headings. */
export const TRUNK_PALETTES: Readonly<Record<Trunk, string>> = {
  Profit: "green",
  Growth: "blue",
  Protect: "orange",
  Foundation: "purple",
};

export const TRUNK_ICONS: Readonly<Record<Trunk, LucideIcon>> = {
  Profit: DollarSign,
  Growth: Activity,
  Protect: TriangleAlert,
  Foundation: FlaskConical,
};

/** One chip: the value it picks, its words, how many items it shows, and its palette. */
interface FilterChip<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly count: number;
  readonly colorPalette?: string;
}

function Chip({
  label,
  count,
  isActive,
  colorPalette = "gray",
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  colorPalette?: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="xs"
      flexShrink={0}
      variant={isActive ? "subtle" : "ghost"}
      colorPalette={isActive ? colorPalette : "gray"}
      borderRadius="full"
      borderWidth="1px"
      borderColor={isActive ? "colorPalette.emphasized" : "border"}
      color={isActive ? "colorPalette.fg" : "fg.muted"}
      fontWeight={isActive ? "semibold" : "normal"}
      paddingX={3}
      aria-pressed={isActive}
      onClick={onClick}
    >
      <HStack gap={1.5}>
        <Text>{label}</Text>
        <Text fontVariantNumeric="tabular-nums" color={isActive ? "colorPalette.fg" : "fg.subtle"}>
          {count}
        </Text>
      </HStack>
    </Button>
  );
}

function FilterChipRow<Value extends string>({
  groupLabel,
  allCount,
  chips,
  picked,
  compact,
  onChange,
}: {
  /** Names the row for assistive technology, e.g. "Filter by agent kind". */
  groupLabel: string;
  allCount: number;
  chips: readonly FilterChip<Value>[];
  picked: readonly Value[];
  compact: boolean;
  onChange: (next: Value[]) => void;
}) {
  const toggle = (value: Value) => onChange(togglePicked({ picked, value }));
  return (
    <HStack
      as="fieldset"
      aria-label={groupLabel}
      gap={1}
      wrap={compact ? "nowrap" : "wrap"}
      overflowX={compact ? "auto" : void 0}
      border="none"
      margin={0}
      padding={0}
    >
      <Chip
        label="All"
        count={allCount}
        isActive={picked.length === 0}
        onClick={() => onChange([])}
      />
      {chips.map((chip) => (
        <Chip
          key={chip.value}
          label={chip.label}
          count={chip.count}
          isActive={picked.includes(chip.value)}
          colorPalette={chip.colorPalette}
          onClick={() => toggle(chip.value)}
        />
      ))}
    </HStack>
  );
}

/**
 * The trunk, agent kind and readiness rows over one set of filters. `compact` keeps each row
 * on one line that scrolls sideways, so a modal's list stays in view.
 */
export function CatalogueFilterChips({
  filters,
  counts,
  compact = false,
  onChange,
}: {
  filters: CatalogueFilters;
  counts: CatalogueChipCounts;
  compact?: boolean;
  onChange: (next: CatalogueFilters) => void;
}) {
  return (
    <VStack align="stretch" gap={compact ? 1.5 : 2}>
      <FilterChipRow
        groupLabel="Filter by trunk"
        allCount={counts.trunks.all}
        picked={filters.trunks}
        compact={compact}
        onChange={(trunks) => onChange({ ...filters, trunks })}
        chips={TRUNKS.map((trunk) => ({
          value: trunk,
          label: trunk,
          count: counts.trunks.byValue[trunk],
          colorPalette: TRUNK_PALETTES[trunk],
        }))}
      />
      <FilterChipRow
        groupLabel="Filter by agent kind"
        allCount={counts.agentKinds.all}
        picked={filters.agentKinds}
        compact={compact}
        onChange={(agentKinds) => onChange({ ...filters, agentKinds })}
        chips={AGENT_KINDS.map((kind) => ({
          value: kind,
          label: AGENT_KIND_LABELS[kind],
          count: counts.agentKinds.byValue[kind],
        }))}
      />
      <FilterChipRow
        groupLabel="Filter by readiness"
        allCount={counts.statuses.all}
        picked={filters.statuses}
        compact={compact}
        onChange={(statuses) => onChange({ ...filters, statuses })}
        chips={CATALOGUE_STATUSES.map((status) => ({
          value: status,
          label: CATALOGUE_STATUS_LABELS[status],
          count: counts.statuses.byValue[status],
        }))}
      />
    </VStack>
  );
}

/**
 * A small label on a card or row that toggles its chip, so a member narrows by what they see.
 * Without `onToggle` it is plain text, for places that do not filter.
 */
export function CatalogueFilterLabel({
  label,
  isActive = false,
  colorPalette = "gray",
  onToggle,
}: {
  label: string;
  isActive?: boolean;
  colorPalette?: string;
  onToggle?: () => void;
}) {
  // A grey label reads as quiet text; a trunk label keeps its colour.
  const restingColor = colorPalette === "gray" ? "fg.muted" : "colorPalette.fg";
  const look = {
    colorPalette,
    borderRadius: "md",
    paddingX: 1.5,
    paddingY: 0.5,
    fontSize: "11px",
    fontWeight: isActive ? "semibold" : "normal",
    background: isActive ? "colorPalette.solid" : "colorPalette.subtle",
    color: isActive ? "colorPalette.contrast" : restingColor,
  } as const;
  if (!onToggle) return <Text {...look}>{label}</Text>;
  return (
    <Button
      {...look}
      size="xs"
      height="auto"
      minWidth={0}
      variant="plain"
      aria-pressed={isActive}
      aria-label={`Filter by ${label}`}
      _hover={{ background: isActive ? "colorPalette.solid" : "colorPalette.muted" }}
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}
