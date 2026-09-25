import {
  Box,
  Button,
  chakra,
  HStack,
  Icon,
  IconButton,
  Input,
  RadioCard,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Kbd } from "@langwatch/design-system/kbd";
import { Popover } from "@langwatch/design-system/popover";
import { Tooltip } from "@langwatch/design-system/tooltip";
import {
  FACET_PERSPECTIVES,
  getFacetGroupId,
  orderedGroupDefsForPerspective,
  useUIStore,
} from "@langwatch/trace-browser-kit";
import {
  Activity,
  AlertCircle,
  BadgeCheck,
  BarChart3,
  Bot,
  Circle,
  CircleDot,
  Compass,
  Cpu,
  Database,
  DollarSign,
  Filter,
  Hash,
  Layers,
  MessageSquare,
  MessageSquareText,
  Search,
  Settings2,
  Sparkles,
  Tag,
  Timer,
  User,
  Users,
  X,
  Zap,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useFacetLensStore } from "../../../../behavior/facet-lens.store.ts";
import type { NumericMode } from "../../../../behavior/numeric-mode.store.ts";

// Default expanded sidebar width (mirrors SIDEBAR_WIDTH_EXPANDED in
// TracesPage). Below this + a little slack the "shown / total" count chip
// in the Configure trigger is dropped so it can't crowd the expand-all
// toggle off the header — at narrow widths the trigger reads just
// "Configure" and the exact tally lives one click inside the picker.
const CONFIGURE_COUNT_MIN_WIDTH = 260;

/** Lucide icon per facet group, rendered next to the group label so
 *  the picker telegraphs each cluster's "type" at a glance. Falls back
 *  to the generic Filter glyph for groups added later without a
 *  hand-picked icon. Keys mirror the Round-3 AI-observability taxonomy
 *  in `constants.FACET_GROUPS`. */
const GROUP_ICON: Record<string, typeof Activity> = {
  traces: Compass,
  errors: AlertCircle,
  spans: Layers,
  subjects: Users,
  model: Sparkles,
  prompts: MessageSquareText,
  quality: BadgeCheck,
  topics: Tag,
  cost: DollarSign,
  latency: Timer,
  volume: Hash,
  custom: Database,
};

/** Per-key icon mapping for the most common facets. Anything not
 *  listed falls back to {@link Filter}. Kept small on purpose: we only
 *  add an icon when it actually disambiguates one facet from another
 *  (a `model` row reading "Model" is fine; the `Cpu` icon next to it
 *  cuts ~50ms off the "which row am I scanning for?" decision). */
const KEY_ICON: Record<string, typeof Filter> = {
  status: AlertCircle,
  errorMessage: AlertCircle,
  origin: Sparkles,
  containsAi: Bot,
  rootSpanType: Layers,
  traceName: Tag,
  model: Cpu,
  service: Cpu,
  topic: Tag,
  subtopic: Tag,
  label: Tag,
  event: Activity,
  user: User,
  conversation: MessageSquare,
  customer: Users,
  scenarioRun: Activity,
  spanName: Tag,
  spanType: Layers,
  spanStatus: AlertCircle,
  annotation: MessageSquareText,
  evaluator: BadgeCheck,
  evaluatorStatus: AlertCircle,
  evaluatorVerdict: BadgeCheck,
  evaluatorScore: BarChart3,
  evaluatorLabel: Tag,
  duration: Timer,
  cost: DollarSign,
  tokens: Hash,
  promptTokens: Hash,
  completionTokens: Hash,
  ttft: Zap,
  ttlt: Zap,
  tokensPerSecond: Zap,
  tokensEstimated: Hash,
  spans: Layers,
  selectedPrompt: MessageSquareText,
  lastUsedPrompt: MessageSquareText,
  promptVersion: Hash,
};

interface FacetManagerPopoverProps {
  /** Every facet key the backend has data for (visible + hidden). */
  orderedKeysAll: string[];
  /** Resolves key → human label; supplied by useFilterSidebarData. */
  sectionByKey: Map<string, { label: string }>;
  /** True when the section is currently rendered in the sidebar. */
  isVisible: (key: string) => boolean;
  /** Force-show a facet (writes `explicitlyShown`). */
  onShow: (key: string) => void;
  /** Force-hide a facet (writes `explicitlyHidden`). */
  onHide: (key: string) => void;
  /** Drop all overrides — sidebar returns to density default. */
  onResetAll: () => void;
  /** Effective presentation mode per discrete-eligible numeric facet. A
   *  missing key means the facet is slider-only (no mode control shown). */
  numericModeByKey: Map<string, NumericMode>;
  /** Switch a numeric facet between its slider and tick-list presentation. */
  setNumericMode: (args: { field: string; mode: NumericMode }) => void;
  /**
   * Optional controlled-open prop. When set, the popover ignores its internal `open`
   * state and mirrors the caller's value (and reports changes via `onOpenChange`).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * When set, the popover renders a labelled text Button as its trigger instead of the
   * default settings-icon IconButton. Drops the tooltip in this mode — the label itself
   * explains the action.
   */
  triggerLabel?: string;
  /**
   * Explicit override for whether the "shown / total" count chip renders on the
   * labelled trigger. When omitted, falls back to the internal sidebar-width heuristic.
   */
  showCount?: boolean;
}

/**
 * One-stop "edit which facets are in my sidebar" picker, opened from the sidebar
 * header.
 */
const BODY_MAX_HEIGHT_PX = 360;

export const FacetManagerPopover: React.FC<FacetManagerPopoverProps> = ({
  orderedKeysAll,
  sectionByKey,
  isVisible,
  onShow,
  onHide,
  onResetAll,
  numericModeByKey,
  setNumericMode,
  open: controlledOpen,
  onOpenChange,
  triggerLabel,
  showCount: showCountOverride,
}) => {
  // Controlled-or-uncontrolled hybrid: when the caller passes `open`
  // we treat it as the source of truth (so the floating Configure CTA
  // can drive the same popover the header icon drives). Without it,
  // the popover keeps its own local state — the original behaviour for
  // sidebar-only consumers.
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [query, setQuery] = useState("");
  // Focus the facet filter as soon as the popover opens so the user can type
  // immediately. Deferred a tick so the popover content has mounted and the
  // open animation has settled before moving focus.
  const filterInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => filterInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Perspective switcher: reads/writes the facet lens store directly so the
  // sidebar (which already consumes the lens order) reorders in lock-step,
  // without threading props through FilterSidebar.
  const activePerspectiveId = useFacetLensStore((s) => s.activePerspectiveId);
  const selectPerspective = useFacetLensStore((s) => s.selectPerspective);

  // Group defs in the active perspective's order — drives the section
  // headers below (the sidebar itself follows via the stamped lens order).
  const orderedGroups = useMemo(
    () => orderedGroupDefsForPerspective(activePerspectiveId),
    [activePerspectiveId],
  );

  const normalisedQuery = query.trim().toLowerCase();

  // Partition `orderedKeysAll` by group id, filtered by the search box
  // when present. Filtering matches against either the human label or
  // the raw key so power users can grep for `selectedPrompt` directly.
  const byGroup = useMemo(
    () => partitionKeysByGroup({ keys: orderedKeysAll, query: normalisedQuery, sectionByKey }),
    [orderedKeysAll, normalisedQuery, sectionByKey],
  );

  const visibleCount = useMemo(
    () => orderedKeysAll.filter(isVisible).length,
    [orderedKeysAll, isVisible],
  );

  // Drop the count chip when the header lacks room so the trigger collapses
  // to just "Configure" and never pushes the expand-all toggle off the edge.
  // The sidebar passes an explicit `showCount` that weighs the other header
  // buttons; only the icon-only path (no override) falls back to the raw
  // width heuristic. `sidebarWidth` null means the auto default width.
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const showCount =
    showCountOverride ?? (sidebarWidth !== null && sidebarWidth >= CONFIGURE_COUNT_MIN_WIDTH);

  const totalMatching = useMemo(
    () => Object.values(byGroup).reduce((acc, ks) => acc + ks.length, 0),
    [byGroup],
  );

  const popover = (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (!e.open) setQuery("");
      }}
      positioning={{
        // `bottom-start` (popover's left edge anchored under the trigger's left edge)
        // so the panel extends INTO the trace list rather than into the main app menu.
        placement: "bottom-start",
        flip: true,
        overflowPadding: 8,
      }}
      lazyMount
      unmountOnExit
    >
      <Popover.Trigger asChild>
        {triggerLabel ? (
          <Button
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            gap={1}
            paddingX={1.5}
            aria-label={`Manage which facets appear in the sidebar (${visibleCount} of ${orderedKeysAll.length} shown)`}
            _hover={{ color: "fg", bg: "bg.muted" }}
          >
            <Settings2 size={12} />
            <Text textStyle="2xs" fontWeight="600">
              {triggerLabel}
            </Text>
            {orderedKeysAll.length > 0 &&
              showCount && (
                // Subtle "shown / available" hint so the user can tell at a
                // glance how many facets are hidden behind the picker without
                // opening it. Hidden when the sidebar is narrow (see showCount).
                <Box
                  as="span"
                  bg="bg.muted"
                  color="fg.subtle"
                  borderRadius="sm"
                  paddingX={1}
                  fontVariantNumeric="tabular-nums"
                >
                  <Text as="span" textStyle="2xs" fontWeight="600">
                    {visibleCount}/{orderedKeysAll.length}
                  </Text>
                </Box>
              )}
          </Button>
        ) : (
          <IconButton
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            aria-label="Manage which facets appear in the sidebar"
          >
            <Settings2 size={14} />
          </IconButton>
        )}
      </Popover.Trigger>
      <Popover.Content width="280px">
        <Popover.Body padding={0}>
          <VStack align="stretch" gap={0}>
            <HStack
              paddingX={3}
              paddingY={2}
              borderBottomWidth="1px"
              borderColor="border.subtle"
              justify="space-between"
            >
              <Text textStyle="xs" fontWeight="semibold" color="fg">
                Facets in sidebar
              </Text>
              <Text textStyle="2xs" color="fg.subtle">
                {visibleCount} of {orderedKeysAll.length}
              </Text>
            </HStack>
            <RadioCard.Root
              unstyled
              value={activePerspectiveId}
              onValueChange={(details) => {
                const chosen = FACET_PERSPECTIVES.find((x) => x.id === details.value);
                if (chosen) selectPerspective(chosen.id);
              }}
              display="flex"
              flexDirection="column"
              alignItems="stretch"
              gap={0}
              paddingX={2}
              paddingTop={2}
              paddingBottom={1}
              borderBottomWidth="1px"
              borderColor="border.subtle"
              aria-label="Perspective"
            >
              <Text
                textStyle="2xs"
                fontWeight="700"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.1em"
                paddingX={1}
                paddingBottom={1}
              >
                Perspective
              </Text>
              {FACET_PERSPECTIVES.map((p) => {
                const active = p.id === activePerspectiveId;
                const RadioIcon = active ? CircleDot : Circle;
                return (
                  <RadioCard.Item
                    key={p.id}
                    value={p.id}
                    unstyled
                    display="flex"
                    alignItems="center"
                    gap={2}
                    paddingX={2}
                    paddingY={1}
                    borderRadius="sm"
                    cursor="pointer"
                    bg={active ? "bg.muted" : undefined}
                    _hover={{ bg: "bg.muted" }}
                    focusVisibleRing="inside"
                  >
                    <RadioCard.ItemHiddenInput />
                    <Icon boxSize={3} color={active ? "blue.solid" : "fg.subtle"}>
                      <RadioIcon />
                    </Icon>
                    <Text textStyle="xs" color="fg" fontWeight={active ? "600" : "500"}>
                      {p.label}
                    </Text>
                  </RadioCard.Item>
                );
              })}
            </RadioCard.Root>
            <Box paddingX={2} paddingY={2}>
              <HStack
                gap={1.5}
                paddingX={2}
                borderWidth="1px"
                borderColor="border"
                borderRadius="sm"
                _focusWithin={{
                  borderColor: "blue.focusRing",
                  boxShadow: "0 0 0 1px var(--chakra-colors-blue-focusRing)",
                }}
              >
                <Search size={12} />
                <Input
                  ref={filterInputRef}
                  size="xs"
                  variant="flushed"
                  placeholder="Filter facets…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  border="none"
                  // Drop the default Input focus ring — the wrapper
                  // HStack owns the focus treatment so the icon + input
                  // read as a single control.
                  _focus={{ boxShadow: "none" }}
                  height="22px"
                  paddingY={0}
                />
                {query && (
                  <IconButton
                    aria-label="Clear filter"
                    size="2xs"
                    variant="ghost"
                    color="fg.subtle"
                    onClick={() => setQuery("")}
                  >
                    <X size={10} />
                  </IconButton>
                )}
              </HStack>
            </Box>
            <Box
              maxHeight={`${BODY_MAX_HEIGHT_PX}px`}
              overflowY="auto"
              borderTopWidth="1px"
              borderColor="border.subtle"
            >
              {totalMatching === 0 ? (
                <Box paddingX={3} paddingY={4}>
                  <Text textStyle="xs" color="fg.subtle">
                    No facets match “{query}”.
                  </Text>
                </Box>
              ) : (
                orderedGroups.map((group) => {
                  const keys = byGroup[group.id] ?? [];
                  if (keys.length === 0) return null;
                  return (
                    <FacetGroupRows
                      key={group.id}
                      group={group}
                      keys={keys}
                      sectionByKey={sectionByKey}
                      isVisible={isVisible}
                      onShow={onShow}
                      onHide={onHide}
                      numericModeByKey={numericModeByKey}
                      setNumericMode={setNumericMode}
                    />
                  );
                })
              )}
            </Box>
            <HStack
              paddingX={3}
              paddingY={2}
              borderTopWidth="1px"
              borderColor="border.subtle"
              justify="space-between"
            >
              <Button size="2xs" variant="ghost" color="fg.muted" onClick={() => onResetAll()}>
                Reset to defaults
              </Button>
              <Button size="2xs" variant="ghost" onClick={() => setOpen(false)}>
                Done
              </Button>
            </HStack>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );

  // Both trigger variants get the same styled tooltip as their sidebar-header siblings
  // — text + Kbd shortcut, bottom-placed — so the header reads as one consistent set of
  // controls.
  return (
    <Tooltip
      positioning={{ placement: "bottom" }}
      content={
        <HStack gap={1.5}>
          <Text>Configure which facets appear</Text>
          <Kbd>C</Kbd>
        </HStack>
      }
      openDelay={300}
    >
      <Box display="inline-flex">{popover}</Box>
    </Tooltip>
  );
};

type FacetRowActions = Pick<
  FacetManagerPopoverProps,
  "sectionByKey" | "isVisible" | "onShow" | "onHide" | "numericModeByKey" | "setNumericMode"
>;

/** One perspective group: its heading, then a toggle row per matching facet. */
const FacetGroupRows: React.FC<
  FacetRowActions & {
    group: ReturnType<typeof orderedGroupDefsForPerspective>[number];
    keys: string[];
  }
> = ({ group, keys, ...actions }) => {
  const GroupIcon = GROUP_ICON[group.id] ?? Filter;
  return (
    <Box>
      <HStack gap={1.5} paddingX={3} paddingTop={2} paddingBottom={1}>
        <Icon boxSize={3} color="fg.subtle">
          <GroupIcon />
        </Icon>
        <Text
          textStyle="2xs"
          fontWeight="700"
          color="fg.subtle"
          textTransform="uppercase"
          letterSpacing="0.1em"
        >
          {group.label}
        </Text>
      </HStack>
      {keys.map((key) => (
        <FacetToggleRow key={key} facetKey={key} {...actions} />
      ))}
    </Box>
  );
};

const FacetToggleRow: React.FC<FacetRowActions & { facetKey: string }> = ({
  facetKey: key,
  sectionByKey,
  isVisible,
  onShow,
  onHide,
  numericModeByKey,
  setNumericMode,
}) => {
  const label = sectionByKey.get(key)?.label ?? key;
  const checked = isVisible(key);
  const KeyIcon = KEY_ICON[key] ?? Filter;
  const mode = numericModeByKey.get(key);
  return (
    <Box
      paddingX={3}
      paddingY={1}
      _hover={{ bg: "bg.muted" }}
      cursor="pointer"
      onClick={() => (checked ? onHide(key) : onShow(key))}
    >
      <HStack justify="space-between" gap={2}>
        <Checkbox
          size="sm"
          checked={checked}
          onCheckedChange={() => (checked ? onHide(key) : onShow(key))}
          onClick={(e) => e.stopPropagation()}
        >
          <HStack gap={1.5}>
            <Icon boxSize={3} color={checked ? "fg.muted" : "fg.subtle"}>
              <KeyIcon />
            </Icon>
            <Text textStyle="xs" color="fg">
              {label}
            </Text>
          </HStack>
        </Checkbox>
        {/* Numeric facets that support both presentations get an inline
            Range/Discrete picker — the same choice as the in-header toggle. */}
        {numericModeByKey.has(key) && (
          <NumericModePicker mode={mode} onPick={(m) => setNumericMode({ field: key, mode: m })} />
        )}
      </HStack>
    </Box>
  );
};

const NumericModePicker: React.FC<{
  mode: NumericMode | undefined;
  onPick: (mode: NumericMode) => void;
}> = ({ mode, onPick }) => (
  <HStack
    gap={0}
    flexShrink={0}
    borderWidth="1px"
    borderColor="border.subtle"
    borderRadius="sm"
    overflow="hidden"
    onClick={(e) => e.stopPropagation()}
  >
    {(["range", "discrete"] as const).map((m) => {
      const active = mode === m;
      return (
        <chakra.button
          key={m}
          type="button"
          aria-pressed={active}
          paddingX={1.5}
          paddingY={0.5}
          color={active ? "fg" : "fg.subtle"}
          bg={active ? "bg.muted" : "transparent"}
          cursor="pointer"
          _hover={{ color: "fg", bg: "bg.muted" }}
          onClick={(e) => {
            e.stopPropagation();
            onPick(m);
          }}
        >
          <Text as="span" textStyle="2xs" fontWeight={active ? "600" : "500"}>
            {m === "range" ? "Range" : "Discrete"}
          </Text>
        </chakra.button>
      );
    })}
  </HStack>
);

/** Keys by facet group, keeping only those whose label or raw key contains the query. */
function partitionKeysByGroup({
  keys,
  query,
  sectionByKey,
}: {
  keys: string[];
  query: string;
  sectionByKey: Map<string, { label: string }>;
}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    if (query && !facetMatchesQuery({ key, query, sectionByKey })) continue;
    const groupId = getFacetGroupId(key) ?? "custom";
    (out[groupId] ??= []).push(key);
  }
  return out;
}

function facetMatchesQuery({
  key,
  query,
  sectionByKey,
}: {
  key: string;
  query: string;
  sectionByKey: Map<string, { label: string }>;
}): boolean {
  const label = sectionByKey.get(key)?.label ?? key;
  return label.toLowerCase().includes(query) || key.toLowerCase().includes(query);
}
