import type React from "react";
import { useFacetHoverStore } from "../../../../index";

/**
 * Escape characters that would break a CSS attribute-value string. Backslashes must be
 * escaped first (otherwise the subsequent double-quote escape's own backslash would be
 * re-escaped).
 */
export function escapeCssAttributeValue(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\A ")
    .replace(/\r/g, "\\D ");
}

/**
 * Cross-component hover highlighter.
 */
export const HoverHighlightStyle: React.FC = () => {
  const facet = useFacetHoverStore((s) => s.hoveredFacet);
  if (!facet) return null;
  const escape = escapeCssAttributeValue;
  const selectors = [
    `[data-filter-chip-field="${escape(facet.field)}"][data-filter-chip-value="${escape(facet.value)}"]`,
    `[data-facet-field="${escape(facet.field)}"][data-facet-value="${escape(facet.value)}"]`,
  ];
  // Background-fill highlight (outlines get clipped by the chips' contained scroll
  // area).
  const palette = /^[a-z]+$/i.test(facet.palette ?? "") ? facet.palette : null;
  const bg = palette
    ? `var(--chakra-colors-${palette}-subtle)`
    : "var(--chakra-colors-bg-emphasized)";
  const border = palette
    ? `var(--chakra-colors-${palette}-muted)`
    : "var(--chakra-colors-border-emphasized)";
  return (
    <style>{`
      ${selectors.join(",\n      ")} {
        background-color: ${bg} !important;
        border-color: ${border} !important;
        transition: background-color 100ms ease, border-color 100ms ease;
      }
    `}</style>
  );
};
