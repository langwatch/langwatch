/** Shell geometry from DESIGN.md section 2; fixed sizes are rem so font preferences scale them. */
export const GUTTER = { base: "4", md: "6", xl: "8" } as const;
export const HEADER_HEIGHT = { base: "100px", lg: "108px" } as const;
export const STICKY_TOP = "calc(var(--docs-header-h) + 1.5rem)";
export const NAV_WIDTH = { lg: "13.5rem", xl: "14.5rem" } as const;

export type PageKind = "home" | "guide" | "endpoint";

/** Maximum frame width per page kind: guide 1280, endpoint 1376 (the 1440 split). */
export const FRAME_MAX: Record<PageKind, string> = { home: "80rem", guide: "80rem", endpoint: "86rem" };
export const ENDPOINT_QUERY = "@media (min-width: 90rem)";
