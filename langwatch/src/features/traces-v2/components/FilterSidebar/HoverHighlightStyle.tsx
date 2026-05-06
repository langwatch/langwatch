import type React from "react";
import type { OrGroup } from "~/server/app-layer/traces/query-language/queries";
import { orGroupColor } from "./orGroupPalette";

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

interface HoverHighlightStyleProps {
  group: OrGroup | null;
  facet: { field: string; value: string } | null;
}

/**
 * Cross-component hover highlighter. Renders a `<style>` block that
 * paints every member of the currently-hovered OR group (or single
 * facet) with the group's palette colour — both the sidebar row
 * (`data-facet-*`) and the search-bar chip (`data-filter-chip-*`)
 * light up together.
 *
 * Lives in its own file because the highlight cross-cuts the sidebar
 * AND the search bar — it isn't a sub-concern of the connector
 * overlay even though they originally shipped together. Mounted by
 * `OrConnectorOverlay` so there's a single instance per sidebar; if
 * we ever want it visible without the connector, lift the mount.
 */
export const HoverHighlightStyle: React.FC<HoverHighlightStyleProps> = ({
  group,
  facet,
}) => {
  if (!group && !facet) return null;
  const palette = group ? orGroupColor(group.id) : "blue";
  const escape = escapeCssAttributeValue;
  const memberSelectors: string[] = [];
  if (group) {
    for (const m of group.members) {
      // Match both the search-bar chip span (data-filter-chip-*) and
      // the sidebar row (data-facet-field + data-facet-value). One
      // style block lights up everything that participates.
      memberSelectors.push(
        `[data-filter-chip-field="${escape(m.field)}"][data-filter-chip-value="${escape(m.value)}"]`,
        `[data-facet-field="${escape(m.field)}"][data-facet-value="${escape(m.value)}"]`,
      );
    }
  } else if (facet) {
    memberSelectors.push(
      `[data-filter-chip-field="${escape(facet.field)}"][data-filter-chip-value="${escape(facet.value)}"]`,
      `[data-facet-field="${escape(facet.field)}"][data-facet-value="${escape(facet.value)}"]`,
    );
  }
  if (memberSelectors.length === 0) return null;
  // Background-fill highlight rather than outline. Outlines were
  // getting clipped by parent overflow:hidden (TipTap renders chips
  // inside a contained scroll area) and even when visible they read
  // as a debug ring rather than a confident highlight. The fill ties
  // the chip + sidebar row visually to the OR group's pill colour:
  // same `subtle` background, same `fg` text colour, same `muted`
  // border. `border-radius: inherit` lets the highlight take on
  // whatever shape the chip already has, so it never spills outside
  // a rounded chip into the surrounding text.
  return (
    <style>{`
      ${memberSelectors.join(",\n      ")} {
        background-color: var(--chakra-colors-${palette}-subtle) !important;
        color: var(--chakra-colors-${palette}-fg) !important;
        border-color: var(--chakra-colors-${palette}-muted) !important;
        transition: background-color 100ms ease, color 100ms ease;
      }
    `}</style>
  );
};
