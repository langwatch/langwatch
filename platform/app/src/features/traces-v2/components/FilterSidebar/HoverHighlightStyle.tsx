import type React from "react";
import { useFacetHoverStore } from "../../stores/facetHoverStore";

/**
 * Escape characters that would break a CSS attribute-value string.
 * Backslashes must be escaped first (otherwise the subsequent
 * double-quote escape's own backslash would be re-escaped). Newlines
 * and carriage returns are illegal in CSS strings without the `\A `
 * form. Without this, user-controlled facet values with `\` or
 * line-breaks could break the selector or inject CSS. Exported so a
 * unit test can hammer it with hostile inputs (`</style>`, NUL bytes,
 * the escape sequences themselves) — the escape function is the only
 * thing standing between a malformed search query and arbitrary CSS
 * injection on the page.
 */
export function escapeCssAttributeValue(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\A ")
    .replace(/\r/g, "\\D ");
}

/**
 * Cross-component hover highlighter. Renders a `<style>` block that
 * paints the currently-hovered facet — both the sidebar row
 * (`data-facet-*`) and the search-bar chip (`data-filter-chip-*`) —
 * with a `blue` highlight so the matching pair lights up together.
 *
 * Reads `hoveredFacet` from the global `facetHoverStore`, which both
 * the sidebar rows and the search-bar chips write to on hover. Mounted
 * once in `FilterSidebar`; the highlight cross-cuts the sidebar AND the
 * search bar, so the style block lives at the document level and applies
 * wherever the matching elements are mounted.
 */
export const HoverHighlightStyle: React.FC = () => {
  const facet = useFacetHoverStore((s) => s.hoveredFacet);
  if (!facet) return null;
  const escape = escapeCssAttributeValue;
  const selectors = [
    `[data-filter-chip-field="${escape(facet.field)}"][data-filter-chip-value="${escape(facet.value)}"]`,
    `[data-facet-field="${escape(facet.field)}"][data-facet-value="${escape(facet.value)}"]`,
  ];
  // Background-fill highlight (outlines get clipped by the chips' contained
  // scroll area). Paint in the facet's OWN palette so the chip ↔ row pair
  // lights up in the value's identity colour and matches the row's selected
  // tint — instead of the old blanket blue that overrode every facet's colour.
  // Guard the palette to a bare token name before interpolating it into a CSS
  // var (injection safety); fall back to a neutral emphasis when the hover came
  // from a search-bar chip, which doesn't carry a palette.
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
