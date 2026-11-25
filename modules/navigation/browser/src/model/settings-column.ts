// The settings column: one centred measure, the header's words on its edges.
// Spec: specs/settings/settings-page-chrome.feature, "On a wide window the column sits in the
// middle".

/** Settings-style page bodies read in one centred column this wide. */
export const SETTINGS_MEASURE = "1248px";
/** The space between a page's header rule and its body: `PageLayout.Container`'s top padding. */
const PAGE_GAP = "var(--chakra-spacing-6)";
/** The gap either side of the centred column, never narrower than the page inset. */
const COLUMN_INSET = `max(var(--page-inset), calc((100% - ${SETTINGS_MEASURE}) / 2))`;

/**
 * The frame's styles: the header's rule spans the full width while its title and actions sit on
 * the column's edges, and the body reads in the centred column. The assistant's floating launcher
 * is a fixed button, so it is skipped.
 */
export function settingsColumnCss(): Record<string, Record<string, string | number>> {
  return {
    "& [data-page-header]": { paddingInline: COLUMN_INSET },
    "& [data-page-header] ~ :not(button), &:not(:has([data-page-header])) > :not(button)": {
      width: `min(${SETTINGS_MEASURE}, calc(100% - 2 * var(--page-inset)))`,
      marginInline: "auto",
    },
    "& [data-page-container]": { paddingInline: 0 },
    // A body that is not a `PageLayout.Container` gets the gap the container draws itself.
    "& [data-page-header] + :not(button, [data-page-container])": { marginTop: PAGE_GAP },
  };
}
