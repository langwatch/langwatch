import { MENU_WIDTH_COMPACT } from "./menu-widths.ts";

/** Navigation-v2 sidebar column; top bar and content column width cap read these */
export const SHELL_SIDEBAR_WIDTH_EXPANDED = "212px";

/** Small screens keep the same collapsed width the current chrome has. */
export const SHELL_SIDEBAR_WIDTH_COMPACT = MENU_WIDTH_COMPACT;

/** Page content width: window less every column beside it */
export function shellContentMaxWidth({
  menuWidth,
  railWidth,
}: {
  menuWidth: string;
  railWidth: string | null;
}): string {
  const inset = Number.parseInt(menuWidth, 10) + (railWidth ? Number.parseInt(railWidth, 10) : 0);
  return `calc(100vw - ${inset}px)`;
}
