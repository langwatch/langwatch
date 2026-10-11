/** Shell geometry from DESIGN.md section 2; fixed sizes are rem so font preferences scale them. */
export const GUTTER = { base: "4", md: "6", xl: "8" } as const;
export const HEADER_HEIGHT = { base: "56px", lg: "64px" } as const;
export const STICKY_TOP = "calc(var(--docs-header-h) + 1.5rem)";
export const NAV_WIDTH = { lg: "14.5rem", xl: "16rem" } as const;

export type PageKind = "home" | "guide" | "endpoint";

/** Maximum frame width per page kind: guide 1312, endpoint 90rem (the 1440 split). */
export const FRAME_MAX: Record<PageKind, string> = { home: "82rem", guide: "82rem", endpoint: "90rem" };
export const ENDPOINT_QUERY = "@media (min-width: 90rem)";
export const GROUND_HEIGHT = "35rem";
