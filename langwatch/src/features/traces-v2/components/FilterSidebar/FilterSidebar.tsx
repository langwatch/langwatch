import {
  Box,
  Button,
  HStack,
  IconButton,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Tokens } from "@chakra-ui/react";
import {
  Activity,
  Boxes,
  Clock,
  Compass,
  DollarSign,
  Filter,
  Hash,
  type LucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Server,
  Sparkles,
  Timer,
} from "lucide-react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type React from "react";
import { useCallback, useMemo } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useTraceFacets } from "../../hooks/useTraceFacets";
import {
  applyLensOrder,
  useFacetLensStore,
} from "../../stores/facetLensStore";
import {
  getFacetValueState,
  getFacetValues,
  getRangeValue,
  useFilterStore,
} from "../../stores/filterStore";
import { useUIStore } from "../../stores/uiStore";
import { STATUS_COLORS, hashColor } from "../../utils/formatters";
import { FIELD_VALUES } from "../../utils/queryParser";
import { AttributesSection } from "./AttributesSection";
import type { FacetItem, FacetValueState } from "./FacetSection";
import { FacetSection } from "./FacetSection";
import { RangeSection } from "./RangeSection";
import { SortableSection } from "./SortableSection";

const ATTRIBUTES_SECTION_KEY = "__attributes__";

const FACET_LABELS: Record<string, string> = {
  ok: "OK",
};

function facetLabel(value: string): string {
  return (
    FACET_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1)
  );
}

/**
 * Status keeps a fixed traffic-light mapping. Origin and Span Type are hashed
 * deterministically per value, so any new value gets a stable, accessible color
 * without the sidebar needing to know about it ahead of time.
 */
const FACET_COLORS: Record<string, Record<string, Tokens["colors"]>> = {
  status: STATUS_COLORS,
};

const SPAN_TYPE_DEFAULTS = [
  "llm",
  "tool",
  "agent",
  "rag",
  "guardrail",
  "evaluation",
  "workflow",
  "chain",
  "module",
  "span",
];

const FACET_DEFAULTS: Record<string, string[]> = {
  origin: FIELD_VALUES.origin ?? [],
  status: FIELD_VALUES.status ?? [],
  spanType: SPAN_TYPE_DEFAULTS,
};

/** Fields where unknown values get a deterministic hash-based dot color. */
const HASH_COLOR_FIELDS = new Set(["origin", "spanType"]);

const FACET_ICONS: Record<string, LucideIcon> = {
  origin: Compass,
  status: Activity,
  spanType: Boxes,
  model: Sparkles,
  service: Server,
  cost: DollarSign,
  duration: Clock,
  ttft: Timer,
  tokens: Hash,
};

/** Order categoricals appear in. Anything not listed here renders after, in registry order. */
const CATEGORICAL_ORDER = [
  "status",
  "origin",
  "spanType",
  "topic",
  "subtopic",
  "service",
  "model",
];

/**
 * Maps a facet field key to its `has:`/`none:` value. When a facet appears here,
 * the sidebar renders a "(none)" row that toggles `none:<value>` in the query.
 */
const NONE_TOGGLE_VALUE: Record<string, string> = {
  user: "user",
  conversation: "conversation",
  topic: "topic",
  subtopic: "subtopic",
  label: "label",
  evaluator: "eval",
};


const RANGE_FORMATTERS: Record<string, (v: number) => string> = {
  tokens: (v) =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)),
  cost: (v) => `$${v.toFixed(4)}`,
  duration: (v) =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`,
  ttft: (v) =>
    v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`,
};

const DEFAULT_RANGE_FORMATTER = (v: number) => String(Math.round(v));

export const FilterSidebar: React.FC = () => {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const ast = useFilterStore((s) => s.ast);
  const toggleFacet = useFilterStore((s) => s.toggleFacet);
  const setRange = useFilterStore((s) => s.setRange);
  const removeRange = useFilterStore((s) => s.removeRange);
  const { data: descriptors } = useTraceFacets();

  const lensSectionOrder = useFacetLensStore((s) => s.lens.sectionOrder);
  const setSectionOrder = useFacetLensStore((s) => s.setSectionOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const makeGetValueState = useCallback(
    (field: string) => {
      return (value: string): FacetValueState =>
        getFacetValueState(ast, field, value);
    },
    [ast],
  );

  const { categoricals, ranges, attributeKeys } = useMemo(() => {
    const cats: Array<{
      key: string;
      label: string;
      topValues: { value: string; label?: string; count: number }[];
    }> = [];
    const rngs: Array<{
      key: string;
      label: string;
      min: number;
      max: number;
    }> = [];
    let attrKeys: { value: string; count: number }[] = [];

    for (const d of descriptors) {
      if (d.kind === "categorical" && d.topValues.length > 0) {
        cats.push(d);
      } else if (d.kind === "range" && d.max > 0) {
        rngs.push(d);
      } else if (d.kind === "dynamic_keys" && d.key === "metadataKeys") {
        attrKeys = d.topKeys;
      }
    }

    cats.sort((a, b) => {
      const ai = CATEGORICAL_ORDER.indexOf(a.key);
      const bi = CATEGORICAL_ORDER.indexOf(b.key);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    return { categoricals: cats, ranges: rngs, attributeKeys: attrKeys };
  }, [descriptors]);

  const facetItems = useMemo(() => {
    const map = new Map<string, FacetItem[]>();
    for (const cat of categoricals) {
      const defaults = FACET_DEFAULTS[cat.key];
      const colors = FACET_COLORS[cat.key];
      const useHash = HASH_COLOR_FIELDS.has(cat.key);
      if (defaults) {
        const record = Object.fromEntries(
          cat.topValues.map((v) => [v.value, v.count]),
        );
        map.set(
          cat.key,
          buildItemsWithDefaults(record, defaults, colors, useHash),
        );
      } else {
        map.set(
          cat.key,
          cat.topValues.map((v) => ({
            value: v.value,
            label: v.label ?? facetLabel(v.value),
            count: v.count,
            dotColor:
              colors?.[v.value] ?? (useHash ? hashColor(v.value) : undefined),
          })),
        );
      }
    }
    return map;
  }, [categoricals]);

  const getValueStates = useMemo(() => {
    const map = new Map<string, (value: string) => FacetValueState>();
    for (const cat of categoricals) {
      map.set(cat.key, makeGetValueState(cat.key));
    }
    return map;
  }, [categoricals, makeGetValueState]);

  if (collapsed) {
    const activeRanges = ranges
      .map((r) => {
        const value = getRangeValue(ast, r.key);
        if (!value) return null;
        const formatter = RANGE_FORMATTERS[r.key] ?? DEFAULT_RANGE_FORMATTER;
        return { ...r, value, formatter };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    return (
      <VStack height="full" gap={0} align="stretch" overflow="hidden" as="aside">
        <VStack
          flex={1}
          paddingY={2}
          gap={1}
          align="center"
          overflowY="auto"
          overflowX="hidden"
        >
          {categoricals.map((cat) => {
            const facet = getFacetValues(ast, cat.key);
            const activeCount = facet.include.length + facet.exclude.length;
            const tooltipLines = [
              ...facet.include.map((v) => ({ text: `+ ${v}`, negated: false })),
              ...facet.exclude.map((v) => ({ text: `− ${v}`, negated: true })),
            ];
            return (
              <CollapsedFacetIcon
                key={cat.key}
                icon={FACET_ICONS[cat.key] ?? Filter}
                label={cat.label}
                isActive={activeCount > 0}
                badgeCount={activeCount}
                tooltipLines={tooltipLines}
                onClick={toggleSidebar}
              />
            );
          })}

          {activeRanges.length > 0 && (
            <Separator marginX={2} marginY={1} width="auto" alignSelf="stretch" />
          )}

          {activeRanges.map((r) => {
            const from = r.value.from;
            const to = r.value.to;
            let summary: string;
            if (from !== undefined && to !== undefined) {
              summary = `${r.formatter(from)} – ${r.formatter(to)}`;
            } else if (from !== undefined) {
              summary = `≥ ${r.formatter(from)}`;
            } else if (to !== undefined) {
              summary = `≤ ${r.formatter(to)}`;
            } else {
              summary = "active";
            }
            return (
              <CollapsedFacetIcon
                key={r.key}
                icon={FACET_ICONS[r.key] ?? Filter}
                label={r.label}
                isActive
                tooltipLines={[{ text: summary, negated: false }]}
                onClick={toggleSidebar}
              />
            );
          })}
        </VStack>

        <Separator />
        <HStack justify="center" paddingY={1.5}>
          <IconButton
            aria-label="Expand sidebar"
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            onClick={toggleSidebar}
          >
            <PanelLeftOpen size={12} />
          </IconButton>
        </HStack>
      </VStack>
    );
  }

  type Section =
    | { kind: "cat"; data: (typeof categoricals)[number] }
    | { kind: "range"; data: (typeof ranges)[number] }
    | { kind: "attributes" };

  const sectionByKey = new Map<string, Section>();
  for (const c of categoricals) sectionByKey.set(c.key, { kind: "cat", data: c });
  for (const r of ranges) sectionByKey.set(r.key, { kind: "range", data: r });
  if (attributeKeys.length > 0) {
    sectionByKey.set(ATTRIBUTES_SECTION_KEY, { kind: "attributes" });
  }

  const naturalOrder = [
    ...categoricals.map((c) => c.key),
    ...ranges.map((r) => r.key),
    ...(attributeKeys.length > 0 ? [ATTRIBUTES_SECTION_KEY] : []),
  ];
  const orderedKeys = applyLensOrder(naturalOrder, lensSectionOrder);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedKeys.indexOf(String(active.id));
    const newIndex = orderedKeys.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    setSectionOrder(arrayMove(orderedKeys, oldIndex, newIndex));
  };

  return (
    <VStack height="full" gap={0} align="stretch" overflow="hidden" as="aside">
      <VStack
        flex={1}
        gap={0}
        align="stretch"
        overflowY="auto"
        overflowX="hidden"
        paddingTop={1}
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={orderedKeys}
            strategy={verticalListSortingStrategy}
          >
            {orderedKeys.map((key) => {
              const section = sectionByKey.get(key);
              if (!section) return null;
              return (
                <SortableSection key={key} id={key}>
                  {({ dragHandleProps }) => {
                    if (section.kind === "cat") {
                      const cat = section.data;
                      const noneToggleValue = NONE_TOGGLE_VALUE[cat.key];
                      const noneRow = noneToggleValue
                        ? {
                            active:
                              getFacetValueState(
                                ast,
                                "none",
                                noneToggleValue,
                              ) === "include",
                            onToggle: () =>
                              toggleFacet("none", noneToggleValue),
                          }
                        : undefined;
                      return (
                        <FacetSection
                          title={cat.label}
                          field={cat.key}
                          items={facetItems.get(cat.key) ?? []}
                          getValueState={
                            getValueStates.get(cat.key) ??
                            (() => "neutral" as const)
                          }
                          onToggle={toggleFacet}
                          dragHandleProps={dragHandleProps}
                          noneRow={noneRow}
                        />
                      );
                    }
                    if (section.kind === "range") {
                      const range = section.data;
                      const current = getRangeValue(ast, range.key);
                      return (
                        <RangeSection
                          title={range.label}
                          field={range.key}
                          min={range.min}
                          max={range.max}
                          currentFrom={current?.from}
                          currentTo={current?.to}
                          formatValue={
                            RANGE_FORMATTERS[range.key] ??
                            DEFAULT_RANGE_FORMATTER
                          }
                          onChange={(from, to) =>
                            setRange(range.key, from, to)
                          }
                          onClear={() => removeRange(range.key)}
                          dragHandleProps={dragHandleProps}
                        />
                      );
                    }
                    return (
                      <AttributesSection
                        keys={attributeKeys}
                        getValueState={(attrKey, value) =>
                          getFacetValueState(
                            ast,
                            `attribute.${attrKey}`,
                            value,
                          )
                        }
                        getNoneActive={(attrKey) =>
                          getFacetValueState(
                            ast,
                            "none",
                            `attribute.${attrKey}`,
                          ) === "include"
                        }
                        onToggleValue={(attrKey, value) =>
                          toggleFacet(`attribute.${attrKey}`, value)
                        }
                        onToggleNone={(attrKey) =>
                          toggleFacet("none", `attribute.${attrKey}`)
                        }
                        dragHandleProps={dragHandleProps}
                      />
                    );
                  }}
                </SortableSection>
              );
            })}
          </SortableContext>
        </DndContext>
      </VStack>

      <Separator />
      <HStack paddingX={3} paddingY={1.5}>
        <Spacer />
        <Button
          aria-label="Collapse sidebar"
          size="2xs"
          variant="ghost"
          color="fg.subtle"
          onClick={toggleSidebar}
        >
          <PanelLeftClose size={12} />
          <Text textStyle="2xs">Collapse</Text>
        </Button>
      </HStack>
    </VStack>
  );
};

function buildItemsWithDefaults(
  record: Record<string, number>,
  defaults: string[],
  colors?: Record<string, Tokens["colors"]>,
  useHash = false,
): FacetItem[] {
  const items: FacetItem[] = defaults.map((value) => ({
    value,
    label: facetLabel(value),
    count: record[value] ?? 0,
    dotColor: colors?.[value] ?? (useHash ? hashColor(value) : undefined),
  }));

  const defaultSet = new Set(defaults);
  for (const [value, count] of Object.entries(record)) {
    if (!defaultSet.has(value)) {
      items.push({
        value,
        label: facetLabel(value),
        count,
        dotColor: colors?.[value] ?? (useHash ? hashColor(value) : undefined),
      });
    }
  }

  return items;
}

interface TooltipLine {
  text: string;
  negated: boolean;
}

const CollapsedFacetIcon: React.FC<{
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  badgeCount?: number;
  tooltipLines: TooltipLine[];
  onClick: () => void;
}> = ({ icon: Icon, label, isActive, badgeCount, tooltipLines, onClick }) => {
  const tooltipContent = isActive ? (
    <VStack gap={0.5} align="start">
      <Text textStyle="xs" fontWeight="semibold">
        {label}
      </Text>
      {tooltipLines.map((line, i) => (
        <Text
          key={`${i}-${line.text}`}
          textStyle="2xs"
          color={line.negated ? "red.fg" : undefined}
        >
          {line.text}
        </Text>
      ))}
    </VStack>
  ) : (
    label
  );

  return (
    <Tooltip content={tooltipContent} positioning={{ placement: "right" }}>
      <IconButton
        aria-label={
          isActive && badgeCount !== undefined
            ? `${label} — ${badgeCount} active filter${badgeCount === 1 ? "" : "s"}`
            : isActive
              ? `${label} — active`
              : label
        }
        size="xs"
        variant="ghost"
        color={isActive ? "blue.fg" : "fg.subtle"}
        onClick={onClick}
        position="relative"
      >
        <Icon size={14} />
        {isActive && badgeCount !== undefined && badgeCount > 0 && (
          <Box
            position="absolute"
            top="-2px"
            right="-2px"
            minWidth="14px"
            height="14px"
            paddingX="3px"
            borderRadius="full"
            bg="blue.solid"
            color="white"
            fontSize="9px"
            fontWeight="600"
            lineHeight="14px"
            textAlign="center"
          >
            {badgeCount}
          </Box>
        )}
        {isActive && badgeCount === undefined && (
          <Box
            position="absolute"
            top="0"
            right="0"
            width="6px"
            height="6px"
            borderRadius="full"
            bg="blue.solid"
          />
        )}
      </IconButton>
    </Tooltip>
  );
};
