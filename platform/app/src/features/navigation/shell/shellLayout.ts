import { MENU_WIDTH_COMPACT } from "~/components/MainMenu";

/**
 * The sidebar column in the navigation-v2 shells. Wider than the
 * current chrome's menu, which is what lets the compact menu type hold
 * the longer product page names on one line.
 *
 * The top bar's product cluster and the content column's width cap both
 * read these, so the three cannot drift apart.
 */
export const SHELL_SIDEBAR_WIDTH_EXPANDED = "212px";

/** Small screens keep the same collapsed width the current chrome has. */
export const SHELL_SIDEBAR_WIDTH_COMPACT = MENU_WIDTH_COMPACT;

/**
 * The room a page has: the window less every column beside it. Pass the
 * rail width on the icon-rail mode, null on the modes with no rail.
 *
 * The columns are added up here rather than inside the `calc`, where
 * `100vw - sidebar + rail` reads left to right and hands the page the width
 * of the rail instead of taking it away, which put the right edge of a full
 * page off the window.
 *
 * Spec: specs/navigation/icon-rail-navigation.feature
 */
export function shellContentMaxWidth({
  menuWidth,
  railWidth,
}: {
  menuWidth: string;
  railWidth: string | null;
}): string {
  const inset =
    Number.parseInt(menuWidth, 10) + (railWidth ? Number.parseInt(railWidth, 10) : 0);
  return `calc(100vw - ${inset}px)`;
}
