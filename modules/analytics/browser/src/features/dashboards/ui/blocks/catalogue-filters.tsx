/**
 * The catalogue's filters, kept quiet: trunk as a segmented row of toggles, agent kind and
 * readiness as checkbox menus with counts, a removable token per picked kind or status, and
 * the card and row labels that toggle them. The library and the picker share all of it.
 */

import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import {
  Activity,
  Bot,
  ChevronDown,
  DollarSign,
  FlaskConical,
  type LucideIcon,
  TriangleAlert,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  AGENT_KIND_LABELS,
  AGENT_KINDS,
  type AgentKind,
  TRUNKS,
  type Trunk,
} from "../../catalogue/index.ts";
import {
  CATALOGUE_STATUS_LABELS,
  CATALOGUE_STATUSES,
  type CatalogueChipCounts,
  type CatalogueFilterPick,
  type CatalogueFilters,
  isPicked,
  togglePicked,
} from "../../model/catalogue-filter.ts";

/** One design-system palette per trunk: its segment icon, its labels and its section headings. */
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

/** The height every control in the filter row shares, so the row reads as one line. */
const CONTROL_HEIGHT = "32px";

function TrunkSegment({
  label,
  count,
  isActive,
  trunk,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  trunk?: Trunk;
  onClick: () => void;
}) {
  const Icon = trunk && TRUNK_ICONS[trunk];
  return (
    <Button
      variant="plain"
      height="full"
      minWidth={0}
      flexShrink={0}
      gap={1.5}
      paddingX={2.5}
      borderRadius="md"
      fontSize="12.5px"
      fontWeight="medium"
      color={isActive ? "fg" : "fg.muted"}
      background={isActive ? "bg.panel" : "transparent"}
      boxShadow={isActive ? "xs" : "none"}
      _hover={{ color: "fg" }}
      aria-pressed={isActive}
      onClick={onClick}
    >
      {Icon && (
        <Box
          as="span"
          display="inline-flex"
          colorPalette={TRUNK_PALETTES[trunk]}
          color="colorPalette.fg"
        >
          <Icon size={12} strokeWidth={2.2} aria-hidden />
        </Box>
      )}
      {label}
      <Text as="span" fontWeight="normal" color="fg.subtle" fontVariantNumeric="tabular-nums">
        {count}
      </Text>
    </Button>
  );
}

/** "All" and each trunk, side by side in one sunken track; several trunks may be on at once. */
function TrunkSegments({
  filters,
  counts,
  onChange,
}: {
  filters: CatalogueFilters;
  counts: CatalogueChipCounts;
  onChange: (next: CatalogueFilters) => void;
}) {
  const picked = filters.trunks;
  return (
    <HStack
      as="fieldset"
      aria-label="Filter by trunk"
      gap={0.5}
      height={CONTROL_HEIGHT}
      maxWidth="full"
      minWidth={0}
      flexShrink={0}
      overflowX="auto"
      margin={0}
      padding="2px"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      background="bg.muted"
    >
      <TrunkSegment
        label="All"
        count={counts.trunks.all}
        isActive={picked.length === 0}
        onClick={() => onChange({ ...filters, trunks: [] })}
      />
      {TRUNKS.map((trunk) => (
        <TrunkSegment
          key={trunk}
          label={trunk}
          trunk={trunk}
          count={counts.trunks.byValue[trunk]}
          isActive={picked.includes(trunk)}
          onClick={() => onChange({ ...filters, trunks: togglePicked({ picked, value: trunk }) })}
        />
      ))}
    </HStack>
  );
}

/** A dropdown of checkable values with counts; the trigger shows how many are on. */
function FilterMenu<Value extends string>({
  label,
  options,
  picked,
  onChange,
}: {
  label: string;
  options: readonly { value: Value; label: string; count: number }[];
  picked: readonly Value[];
  onChange: (next: Value[]) => void;
}) {
  return (
    <Menu.Root closeOnSelect={false} positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button
          variant="outline"
          height={CONTROL_HEIGHT}
          flexShrink={0}
          gap={1.5}
          paddingX={3}
          fontSize="12.5px"
          fontWeight="medium"
        >
          {label}
          {picked.length > 0 && (
            <Text
              as="span"
              minWidth="18px"
              paddingX={1}
              borderRadius="full"
              fontSize="11px"
              lineHeight="18px"
              textAlign="center"
              colorPalette="accent"
              background="colorPalette.subtle"
              color="colorPalette.fg"
            >
              {picked.length}
            </Text>
          )}
          <ChevronDown size={14} aria-hidden />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="248px">
        {options.map((option) => (
          <Menu.CheckboxItem
            key={option.value}
            value={option.value}
            checked={picked.includes(option.value)}
            onCheckedChange={() => onChange(togglePicked({ picked, value: option.value }))}
          >
            <HStack width="full" gap={4} fontSize="13px">
              <Text as="span" flex={1} truncate>
                {option.label}
              </Text>
              <Text as="span" color="fg.subtle" fontVariantNumeric="tabular-nums">
                {option.count}
              </Text>
            </HStack>
          </Menu.CheckboxItem>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

/** A picked agent kind or status the menus hide, shown so it can be seen and removed. */
function ActiveTokens({
  filters,
  onChange,
}: {
  filters: CatalogueFilters;
  onChange: (next: CatalogueFilters) => void;
}) {
  const tokens = [
    ...filters.agentKinds.map((kind) => ({
      key: kind,
      label: AGENT_KIND_LABELS[kind],
      next: { ...filters, agentKinds: togglePicked({ picked: filters.agentKinds, value: kind }) },
    })),
    ...filters.statuses.map((status) => ({
      key: status,
      label: CATALOGUE_STATUS_LABELS[status],
      next: { ...filters, statuses: togglePicked({ picked: filters.statuses, value: status }) },
    })),
  ];
  if (tokens.length === 0) return null;
  return (
    <HStack gap={1.5} wrap="wrap">
      {tokens.map(({ key, label, next }) => (
        <Button
          key={key}
          variant="plain"
          height="24px"
          gap={1}
          paddingStart={2}
          paddingEnd={1.5}
          borderRadius="md"
          fontSize="12px"
          fontWeight="medium"
          color="fg.muted"
          background="bg.muted"
          _hover={{ color: "fg", background: "bg.emphasized" }}
          aria-label={`Remove ${label} filter`}
          onClick={() => onChange(next)}
        >
          {label}
          <X size={12} aria-hidden />
        </Button>
      ))}
      <Button
        variant="plain"
        height="24px"
        paddingX={1.5}
        fontSize="12px"
        fontWeight="medium"
        color="fg.subtle"
        _hover={{ color: "fg" }}
        onClick={() => onChange({ ...filters, agentKinds: [], statuses: [] })}
      >
        Clear filters
      </Button>
    </HStack>
  );
}

/**
 * The filter row: `leading` (the library's search) first, the trunk track, then the menus
 * at the end. `compact` keeps the row on one line that scrolls sideways, for the picker.
 */
export function CatalogueFilterBar({
  filters,
  counts,
  leading,
  compact = false,
  onChange,
}: {
  filters: CatalogueFilters;
  counts: CatalogueChipCounts;
  leading?: ReactNode;
  compact?: boolean;
  onChange: (next: CatalogueFilters) => void;
}) {
  return (
    <VStack align="stretch" gap={2.5}>
      <HStack
        as="fieldset"
        aria-label="Filters"
        minWidth={0}
        margin={0}
        padding={0}
        border="none"
        gap={2}
        wrap={compact ? "nowrap" : "wrap"}
        overflowX={compact ? "auto" : void 0}
      >
        {leading}
        <TrunkSegments filters={filters} counts={counts} onChange={onChange} />
        <HStack gap={2} marginStart={compact ? 0 : "auto"} flexShrink={0}>
          <FilterMenu
            label="Agent kind"
            picked={filters.agentKinds}
            onChange={(agentKinds) => onChange({ ...filters, agentKinds })}
            options={AGENT_KINDS.map((kind) => ({
              value: kind,
              label: AGENT_KIND_LABELS[kind],
              count: counts.agentKinds.byValue[kind],
            }))}
          />
          <FilterMenu
            label="Status"
            picked={filters.statuses}
            onChange={(statuses) => onChange({ ...filters, statuses })}
            options={CATALOGUE_STATUSES.map((status) => ({
              value: status,
              label: CATALOGUE_STATUS_LABELS[status],
              count: counts.statuses.byValue[status],
            }))}
          />
        </HStack>
      </HStack>
      <ActiveTokens filters={filters} onChange={onChange} />
    </VStack>
  );
}

/**
 * A small label on a card or row that toggles its filter, so a member narrows by what they
 * see. Without `onToggle` it is plain text, for places that do not filter.
 */
export function CatalogueFilterLabel({
  label,
  icon: Icon,
  isActive = false,
  colorPalette = "gray",
  shape = "chip",
  onToggle,
}: {
  label: string;
  icon?: LucideIcon;
  isActive?: boolean;
  colorPalette?: string;
  /** A rounded `badge` sits beside a name; a `chip` lists what an item suits. */
  shape?: "chip" | "badge";
  onToggle?: () => void;
}) {
  const isTrunk = colorPalette !== "gray";
  const resting = isTrunk
    ? { background: "colorPalette.subtle", color: "colorPalette.fg" }
    : { background: "bg.muted", color: "fg.muted" };
  const look = {
    colorPalette,
    display: "inline-flex",
    alignItems: "center",
    gap: 1,
    height: shape === "badge" ? "20px" : "22px",
    minWidth: 0,
    borderRadius: shape === "badge" ? "full" : "md",
    paddingX: shape === "badge" ? 2 : 1.5,
    fontSize: shape === "badge" ? "11px" : "12px",
    fontWeight: shape === "badge" || isActive ? "medium" : "normal",
    ...(isActive ? { background: "colorPalette.solid", color: "colorPalette.contrast" } : resting),
  } as const;
  const content = (
    <>
      {Icon && <Icon size={11} aria-hidden />}
      {label}
    </>
  );
  if (!onToggle) return <Text {...look}>{content}</Text>;
  return (
    <Button
      {...look}
      size="xs"
      variant="plain"
      aria-pressed={isActive}
      aria-label={`Filter by ${label}`}
      _hover={isActive ? void 0 : { background: isTrunk ? "colorPalette.muted" : "bg.emphasized" }}
      onClick={onToggle}
    >
      {content}
    </Button>
  );
}

/** How many agent kinds a card or row lists before folding the rest behind "+N". */
const SHOWN_AGENT_KINDS = 3;

/**
 * The agent kinds an item suits, as labels: picked kinds first, the first few shown and the
 * rest behind one "+N" button, so a template made for every kind stays one quiet line.
 */
export function AgentKindLabels({
  agentKinds,
  filters,
  onFilter,
}: {
  agentKinds: readonly AgentKind[];
  /** The view the labels show as picked; only where the labels filter. */
  filters?: CatalogueFilters;
  onFilter?: (pick: CatalogueFilterPick) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  if (agentKinds.length === 0) return <CatalogueFilterLabel label="Any agent" icon={Bot} />;

  const picked = (kind: AgentKind) =>
    filters !== void 0 && isPicked({ filters, pick: { group: "agentKinds", value: kind } });
  const ordered = agentKinds.toSorted((a, b) => Number(picked(b)) - Number(picked(a)));
  const shown = isExpanded ? ordered : ordered.slice(0, SHOWN_AGENT_KINDS);
  const hidden = ordered.length - shown.length;
  return (
    <>
      {shown.map((kind) => (
        <CatalogueFilterLabel
          key={kind}
          label={AGENT_KIND_LABELS[kind]}
          icon={Bot}
          isActive={picked(kind)}
          onToggle={onFilter && (() => onFilter({ group: "agentKinds", value: kind }))}
        />
      ))}
      {hidden > 0 && (
        <Button
          variant="plain"
          size="xs"
          height="22px"
          minWidth={0}
          paddingX={1.5}
          borderRadius="md"
          fontSize="12px"
          fontWeight="normal"
          color="fg.subtle"
          _hover={{ color: "fg", background: "bg.muted" }}
          aria-label={`Show ${hidden} more agent kinds`}
          aria-expanded={false}
          onClick={() => setIsExpanded(true)}
        >
          +{hidden}
        </Button>
      )}
    </>
  );
}
