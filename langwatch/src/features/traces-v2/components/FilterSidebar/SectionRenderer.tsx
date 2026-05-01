import type { LiqeQuery } from "liqe";
import type React from "react";
import {
  getFacetValueState,
  getRangeValue,
} from "~/server/app-layer/traces/query-language/queries";
import { AttributesSection } from "./AttributesSection";
import { NONE_TOGGLE_VALUE } from "./constants";
import { FacetSection } from "./FacetSection";
import { RangeSection } from "./RangeSection";
import type {
  FacetItem,
  FacetValueState,
  Section,
} from "./types";
import { getFacetIcon, getRangeFormatter } from "./utils";

interface SectionRendererProps {
  section: Section;
  ast: LiqeQuery;
  facetItemsByKey: Map<string, FacetItem[]>;
  valueStateGetters: Map<string, (value: string) => FacetValueState>;
  toggleFacet: (field: string, value: string) => void;
  setRange: (field: string, from: string, to: string) => void;
  removeRange: (field: string) => void;
  onShiftToggle: (nextOpen: boolean) => void;
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
}) => {
  const icon = getFacetIcon({ key: section.key, group: section.group });

  if (section.kind === "cat") {
    const noneToggleValue = NONE_TOGGLE_VALUE[section.key];
    const noneRow = noneToggleValue
      ? {
          active:
            getFacetValueState(ast, "none", noneToggleValue) === "include",
          onToggle: () => toggleFacet("none", noneToggleValue),
        }
      : undefined;

    return (
      <FacetSection
        title={section.label}
        icon={icon}
        field={section.key}
        items={facetItemsByKey.get(section.key)!}
        getValueState={valueStateGetters.get(section.key)!}
        onToggle={toggleFacet}
        onShiftToggle={onShiftToggle}
        noneRow={noneRow}
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
        onChange={(from, to) => setRange(section.key, String(from), String(to))}
        onClear={() => removeRange(section.key)}
        onShiftToggle={onShiftToggle}
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
      onToggleValue={(attrKey, value) => toggleFacet(fieldFor(attrKey), value)}
      onToggleNone={(attrKey) => toggleFacet("none", fieldFor(attrKey))}
      onShiftToggle={onShiftToggle}
    />
  );
};
