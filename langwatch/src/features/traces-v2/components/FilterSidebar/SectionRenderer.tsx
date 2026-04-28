import type React from "react";
import {
  getFacetValueState,
  getRangeValue,
  type LiqeQuery,
} from "../../utils/queryParser";
import { AttributesSection } from "./AttributesSection";
import { ATTRIBUTES_SECTION_KEY, NONE_TOGGLE_VALUE } from "./constants";
import { FacetSection } from "./FacetSection";
import { RangeSection } from "./RangeSection";
import type { AttributeKey, FacetItem, FacetValueState, Section } from "./types";
import { getFacetIcon, getRangeFormatter } from "./utils";

interface SectionRendererProps {
  section: Section;
  ast: LiqeQuery;
  attributeKeys: AttributeKey[];
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
  attributeKeys,
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
        onChange={(from, to) => setRange(section.key, from, to)}
        onClear={() => removeRange(section.key)}
        onShiftToggle={onShiftToggle}
      />
    );
  }

  return (
    <AttributesSection
      icon={getFacetIcon({
        key: ATTRIBUTES_SECTION_KEY,
        group: "metadata",
      })}
      keys={attributeKeys}
      getValueState={(attrKey, value) =>
        getFacetValueState(ast, `attribute.${attrKey}`, value)
      }
      getNoneActive={(attrKey) =>
        getFacetValueState(ast, "none", `attribute.${attrKey}`) === "include"
      }
      onToggleValue={(attrKey, value) =>
        toggleFacet(`attribute.${attrKey}`, value)
      }
      onToggleNone={(attrKey) => toggleFacet("none", `attribute.${attrKey}`)}
      onShiftToggle={onShiftToggle}
    />
  );
};
