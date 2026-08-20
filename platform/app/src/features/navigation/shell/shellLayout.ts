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
