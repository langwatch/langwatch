import { MENU_WIDTH_COMPACT } from "./menu-widths.ts";

/** Navigation-v2 sidebar column; top bar and content column width cap read these */
export const SHELL_SIDEBAR_WIDTH_EXPANDED = "212px";

/** The reader may drag the sidebar wider, from its default width up to this. */
export const SHELL_SIDEBAR_WIDTH_MIN = Number.parseInt(SHELL_SIDEBAR_WIDTH_EXPANDED, 10);
export const SHELL_SIDEBAR_WIDTH_MAX = 480;

/** The width the sidebar draws at for a remembered width, which may be absent or out of range. */
export function shellSidebarWidth({ remembered }: { remembered: number | null }): number {
  if (remembered === null || !Number.isFinite(remembered)) return SHELL_SIDEBAR_WIDTH_MIN;
  return Math.round(
    Math.min(SHELL_SIDEBAR_WIDTH_MAX, Math.max(SHELL_SIDEBAR_WIDTH_MIN, remembered)),
  );
}

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

/** The content card makes room for the docked assistant on the dock's own slide. */
export const LANGY_DOCK_TRANSITION = "240ms cubic-bezier(0.32, 0.72, 0, 1)";
