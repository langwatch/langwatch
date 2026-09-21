import { Box } from "@chakra-ui/react";
import type { LiqeQuery } from "liqe";
import { ChevronDown, ChevronRight } from "lucide-react";
import type React from "react";
import { memo } from "react";
import {
  getFacetValueState,
  getRangeValue,
} from "~/server/app-layer/traces/query-language/queries";
import type { NumericMode } from "../../stores/numericModeStore";
import { AttributesSection } from "./AttributesSection";
import { NONE_TOGGLE_VALUE } from "./constants";
import { EvaluatorDrilldown } from "./EvaluatorDrilldown";
import { EventDrilldown } from "./EventDrilldown";
import { FacetSection } from "./FacetSection";
import { RangeSection } from "./RangeSection";
import type { FacetItem, FacetValueState, Section } from "./types";
import { getFacetIcon, getRangeFormatter } from "./utils";

interface SectionRendererProps {
  section: Section;
  ast: LiqeQuery;
  facetItemsByKey: Map<string, FacetItem[]>;
  valueStateGetters: Map<string, (value: string) => FacetValueState>;
  toggleFacet: ({ field, value }: { field: string; value: string }) => void;
  /** Force a categorical value to excluded / back to neutral — drives the
   * row's trailing exclude affordance. */
  excludeFacet: ({ field, value }: { field: string; value: string }) => void;
  setRange: ({
    field,
    from,
    to,
  }: {
    field: string;
    from: string;
    to: string;
  }) => void;
  removeRange: ({ field }: { field: string }) => void;
  /** Evaluator-scoped group mutations — passed straight to the evaluator
   * drilldown so its verdict / score / label picks land inside
   * `(evaluator:X AND …)` rather than as flat top-level clauses. */
  toggleEvaluatorSubFilter: (args: {
    evaluatorId: string;
    field: string;
    value: string;
  }) => void;
  setEvaluatorScoreRange: (args: {
    evaluatorId: string;
    from: string;
    to: string;
  }) => void;
  removeEvaluatorScoreRange: (args: { evaluatorId: string }) => void;
  onShiftToggle: (nextOpen: boolean) => void;
  /** Called when the user clicks the X to remove this section from
   * the sidebar. Threaded into the section components which surface
   * the affordance in their headers. */
  onHide?: () => void;
  /**
   * Drag handle props from the surrounding sortable wrapper. With the
   * group-of-groups removed, individual sections are now the unit
   * users drag to reorder the sidebar — every section becomes its own
   * sortable. The SidebarSection header renders a GripVertical handle
   * the moment this prop is set; without it the handle stays hidden
   * so non-sortable consumers (popover preview, etc.) don't render a
   * dead affordance.
   */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Effective presentation mode per discrete-eligible numeric facet. A
   *  missing key means the facet is slider-only (no toggle). */
  numericModeByKey: Map<string, NumericMode>;
  /** Switch a numeric facet between its slider and tick-list presentation. */
  setNumericMode: (args: { field: string; mode: NumericMode }) => void;
}

/**
 * The trailing chevron that expands an INACTIVE row's inline drilldown
 * (evaluator breakdown, event metric breakdown). Rendered as a sibling of
 * the row button so a click here never toggles the facet — stopPropagation
 * guards against any outer container handler too.
 */
const ExpandChevron: React.FC<{
  isExpanded: boolean;
  onToggleExpand: () => void;
  /** Noun for the aria-label: "Show/Hide <subject> breakdown". */
  subject: string;
}> = ({ isExpanded, onToggleExpand, subject }) => (
  <Box
    as="button"
    aria-label={`${isExpanded ? "Hide" : "Show"} ${subject} breakdown`}
    aria-expanded={isExpanded}
    display="flex"
    alignItems="center"
    justifyContent="center"
    flexShrink={0}
    width="20px"
    height="20px"
    borderRadius="sm"
    cursor="pointer"
    color="fg.subtle"
    background="transparent"
    border="none"
    onClick={(e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand();
    }}
    _hover={{ color: "fg.muted", background: "bg.muted" }}
  >
    <Box
      as={isExpanded ? ChevronDown : ChevronRight}
      width="12px"
      height="12px"
    />
  </Box>
);

const SectionRendererInner: React.FC<SectionRendererProps> = ({
  section,
  ast,
  facetItemsByKey,
  valueStateGetters,
  toggleFacet,
  excludeFacet,
  setRange,
  removeRange,
  toggleEvaluatorSubFilter,
  setEvaluatorScoreRange,
  removeEvaluatorScoreRange,
  onShiftToggle,
  onHide,
  dragHandleProps,
  numericModeByKey,
  setNumericMode,
}) => {
  const icon = getFacetIcon({ key: section.key, group: section.group });

  if (section.kind === "cat") {
    const noneToggleValue = NONE_TOGGLE_VALUE[section.key];
    const noneRow = noneToggleValue
      ? {
          active:
            getFacetValueState(ast, "none", noneToggleValue) === "include",
          onToggle: () =>
            toggleFacet({ field: "none", value: noneToggleValue }),
        }
      : undefined;

    // Evaluator section gets an inline drilldown rendered under each
    // ACTIVE evaluator row — verdict pills, score range, label flag —
    // sourced from the `aggregates` the discover endpoint already
    // attached to each evaluator value. No second query.
    // Event section mirrors the evaluator pattern with its own payload:
    // per-event metric values (thumbs_up_down → vote 1 / -1) ride the
    // discover response as `eventMetrics`; the drilldown emits plain
    // top-level `event.attribute.<key>` toggles. No second query.
    const renderActiveRowExtras =
      section.key === "event"
        ? (item: FacetItem) =>
            item.eventMetrics ? (
              <EventDrilldown item={item} ast={ast} toggleFacet={toggleFacet} />
            ) : null
        : section.key === "evaluator"
          ? (item: FacetItem) =>
              item.aggregates ? (
                <EvaluatorDrilldown
                  item={item}
                  ast={ast}
                  toggleSubFilter={({ field, value }) =>
                    toggleEvaluatorSubFilter({
                      evaluatorId: item.value,
                      field,
                      value,
                    })
                  }
                  setScoreRange={({ from, to }) =>
                    setEvaluatorScoreRange({
                      evaluatorId: item.value,
                      from,
                      to,
                    })
                  }
                  removeScoreRange={() =>
                    removeEvaluatorScoreRange({ evaluatorId: item.value })
                  }
                />
              ) : null
          : undefined;

    // INACTIVE evaluator rows also get a drilldown affordance: a small
    // chevron expand toggle. It renders inline at the row's trailing edge
    // (via the `trailing` slot) rather than as a full-width strip beneath
    // the row — clicking it browses verdict/score options before
    // committing to the evaluator filter. When the user then picks a
    // verdict or score range, the evaluator toggle fires first so the
    // selected criteria applies correctly.
    const renderInactiveRowExtras =
      section.key === "event"
        ? (
            item: FacetItem,
            isExpanded: boolean,
            onToggleExpand: () => void,
          ) => {
            // No metrics on this event type → no expand affordance (same
            // gating the evaluator applies via `aggregates`).
            if (!item.eventMetrics) return null;
            return {
              trailing: (
                <ExpandChevron
                  isExpanded={isExpanded}
                  onToggleExpand={onToggleExpand}
                  subject="event metric"
                />
              ),
              below: isExpanded ? (
                <EventDrilldown
                  item={item}
                  ast={ast}
                  toggleFacet={toggleFacet}
                />
              ) : null,
            };
          }
        : section.key === "evaluator"
          ? (
              item: FacetItem,
              isExpanded: boolean,
              onToggleExpand: () => void,
            ) => {
              if (!item.aggregates) return null;
              // Picking a verdict / score / label on an inactive evaluator
              // also enables the `evaluator:<id>` anchor — the group mutation
              // adds it automatically, so no explicit activation wrapper is
              // needed here.
              return {
                trailing: (
                  <ExpandChevron
                    isExpanded={isExpanded}
                    onToggleExpand={onToggleExpand}
                    subject="evaluator"
                  />
                ),
                below: isExpanded ? (
                  <EvaluatorDrilldown
                    item={item}
                    ast={ast}
                    toggleSubFilter={({ field, value }) =>
                      toggleEvaluatorSubFilter({
                        evaluatorId: item.value,
                        field,
                        value,
                      })
                    }
                    setScoreRange={({ from, to }) =>
                      setEvaluatorScoreRange({
                        evaluatorId: item.value,
                        from,
                        to,
                      })
                    }
                    removeScoreRange={() =>
                      removeEvaluatorScoreRange({ evaluatorId: item.value })
                    }
                  />
                ) : null,
              };
            }
          : undefined;

    const facetSection = (
      <FacetSection
        title={section.label}
        icon={icon}
        field={section.key}
        items={facetItemsByKey.get(section.key)!}
        getValueState={valueStateGetters.get(section.key)!}
        onToggle={(field, value) => toggleFacet({ field, value })}
        onExclude={(field, value) => excludeFacet({ field, value })}
        onShiftToggle={onShiftToggle}
        onHide={onHide}
        dragHandleProps={dragHandleProps}
        noneRow={noneRow}
        renderActiveRowExtras={renderActiveRowExtras}
        renderInactiveRowExtras={renderInactiveRowExtras}
        synthetic={section.synthetic}
        // Categorical facets get server-side value search; the discrete-range
        // branch below omits it (the discriminator is the render BRANCH, not
        // the `field`). See useFacetSearch — server search is categorical-only.
        serverValueSearch
      />
    );

    // Stable spotlight anchor for the tour's evaluator step — the
    // drilldown anchor only exists while a row is expanded, so the
    // tour falls back to the whole evaluator section.
    if (section.key === "evaluator") {
      return <Box data-spotlight="evaluator-section">{facetSection}</Box>;
    }
    return facetSection;
  }

  if (section.kind === "range") {
    // Discrete-eligible numeric facets carry an entry in `numericModeByKey`.
    // When the effective mode is "discrete" the distinct values render as a
    // categorical multi-select (reusing FacetSection); otherwise the slider.
    // The header toggle, present in both, flips between them.
    const mode = numericModeByKey.get(section.key);
    const modeToggleProps =
      mode !== undefined
        ? {
            mode,
            onToggle: () =>
              setNumericMode({
                field: section.key,
                mode: mode === "discrete" ? "range" : "discrete",
              }),
          }
        : undefined;

    if (mode === "discrete") {
      return (
        <FacetSection
          title={section.label}
          icon={icon}
          field={section.key}
          items={facetItemsByKey.get(section.key) ?? []}
          getValueState={
            valueStateGetters.get(section.key) ??
            ((): FacetValueState => "neutral")
          }
          onToggle={(field, value) => toggleFacet({ field, value })}
          onExclude={(field, value) => excludeFacet({ field, value })}
          onShiftToggle={onShiftToggle}
          onHide={onHide}
          dragHandleProps={dragHandleProps}
          synthetic={section.synthetic}
          modeToggleProps={modeToggleProps}
        />
      );
    }

    const current = getRangeValue(ast, section.key);
    return (
      <RangeSection
        title={section.label}
        icon={icon}
        field={section.key}
        min={section.min}
        max={section.max}
        currentFrom={current?.from}
        currentTo={current?.to}
        formatValue={getRangeFormatter(section.key)}
        onChange={(from, to) =>
          setRange({ field: section.key, from: String(from), to: String(to) })
        }
        onClear={() => removeRange({ field: section.key })}
        onShiftToggle={onShiftToggle}
        onHide={onHide}
        dragHandleProps={dragHandleProps}
        synthetic={section.synthetic}
        modeToggleProps={modeToggleProps}
      />
    );
  }

  // Attributes section: same component for trace, span, event, and metadata —
  // the section data carries its own filter prefix (`attribute.` vs
  // `span.attribute.` vs `event.attribute.`) and key list, so the renderer
  // doesn't need to know which flavour it's drawing. `displayStripPrefix` (set
  // only on the Metadata section) trims the redundant `metadata.` from the
  // rendered label; the FULL key still drives `fieldFor`, so the filter
  // resolves to the same trace-attribute predicate.
  const { filterPrefix, keys, label, displayStripPrefix, emptyDocsHref } =
    section;
  const fieldFor = (attrKey: string) => `${filterPrefix}.${attrKey}`;
  return (
    <AttributesSection
      title={label}
      icon={icon}
      keys={keys}
      filterPrefix={filterPrefix}
      displayStripPrefix={displayStripPrefix}
      emptyDocsHref={emptyDocsHref}
      getValueState={(attrKey, value) =>
        getFacetValueState(ast, fieldFor(attrKey), value)
      }
      getNoneActive={(attrKey) =>
        getFacetValueState(ast, "none", fieldFor(attrKey)) === "include"
      }
      onToggleValue={(attrKey, value) =>
        toggleFacet({ field: fieldFor(attrKey), value })
      }
      onToggleNone={(attrKey) =>
        toggleFacet({ field: "none", value: fieldFor(attrKey) })
      }
      onShiftToggle={onShiftToggle}
      onHide={onHide}
      dragHandleProps={dragHandleProps}
    />
  );
};

export const SectionRenderer = memo(SectionRendererInner);
