import type { LiqeQuery } from "liqe";
import type React from "react";
import {
  getFacetValueState,
  getRangeValue,
} from "~/server/app-layer/traces/query-language/queries";
import { AttributesSection } from "./AttributesSection";
import { NONE_TOGGLE_VALUE } from "./constants";
import { EvaluatorDrilldown } from "./EvaluatorDrilldown";
import { FacetSection } from "./FacetSection";
import { RangeSection } from "./RangeSection";
import type { FacetItem, FacetValueState, Section } from "./types";
import { getFacetIcon, getRangeFormatter } from "./utils";

interface SectionRendererProps {
  section: Section;
  ast: LiqeQuery;
  facetItemsByKey: Map<string, FacetItem[]>;
  valueStateGetters: Map<string, (value: string) => FacetValueState>;
  toggleFacet: ({
    field,
    value,
    isModifierKey,
  }: {
    field: string;
    value: string;
    isModifierKey?: boolean;
  }) => void;
  /** Set when this section's field belongs to a cross-facet OR group;
   * threaded into the section so it can render its "linked" badge. */
  orGroupId?: string;
  /** Other field names in the same OR group — shown in the badge as
   * "OR · model" so users see exactly which sections are linked. */
  orPeers?: readonly string[];
  /** Set of values from THIS field that are members of the OR group;
   * those rows get a coloured ring so the user can see which specific
   * values participate. */
  orMemberValues?: ReadonlySet<string>;
  setRange: ({ field, from, to }: { field: string; from: string; to: string }) => void;
  removeRange: ({ field }: { field: string }) => void;
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
}

export const SectionRenderer: React.FC<SectionRendererProps> = ({
  section,
  ast,
  facetItemsByKey,
  valueStateGetters,
  toggleFacet,
  setRange,
  removeRange,
  onShiftToggle,
  onHide,
  orGroupId,
  orPeers,
  orMemberValues,
  dragHandleProps,
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
    const renderActiveRowExtras =
      section.key === "evaluator"
        ? (item: FacetItem) =>
            item.aggregates ? (
              <EvaluatorDrilldown
                item={item}
                ast={ast}
                toggleFacet={toggleFacet}
                setRange={setRange}
                removeRange={removeRange}
              />
            ) : null
        : undefined;

    return (
      <FacetSection
        title={section.label}
        icon={icon}
        field={section.key}
        items={facetItemsByKey.get(section.key)!}
        getValueState={valueStateGetters.get(section.key)!}
        onToggle={(field, value, options) =>
          toggleFacet({ field, value, isModifierKey: options?.modifierKey })
        }
        onShiftToggle={onShiftToggle}
        onHide={onHide}
        dragHandleProps={dragHandleProps}
        noneRow={noneRow}
        orGroupId={orGroupId}
        orPeers={orPeers}
        orMemberValues={orMemberValues}
        renderActiveRowExtras={renderActiveRowExtras}
      />
    );
  }

  if (section.kind === "range") {
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
        orGroupId={orGroupId}
        orPeers={orPeers}
      />
    );
  }

  // Attributes section: same component for trace, span, and event — the
  // section data carries its own filter prefix (`attribute.` vs
  // `span.attribute.` vs `event.attribute.`) and key list, so the renderer
  // doesn't need to know which flavour it's drawing.
  const { filterPrefix, keys, label } = section;
  const fieldFor = (attrKey: string) => `${filterPrefix}.${attrKey}`;
  return (
    <AttributesSection
      title={label}
      icon={icon}
      keys={keys}
      getValueState={(attrKey, value) =>
        getFacetValueState(ast, fieldFor(attrKey), value)
      }
      getNoneActive={(attrKey) =>
        getFacetValueState(ast, "none", fieldFor(attrKey)) === "include"
      }
      onToggleValue={(attrKey, value, options) =>
        toggleFacet({
          field: fieldFor(attrKey),
          value,
          isModifierKey: options?.modifierKey,
        })
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
