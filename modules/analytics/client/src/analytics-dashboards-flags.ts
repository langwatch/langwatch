/**
 * The flags the organization's Dashboards area opens behind, each asked of the organization
 * (ADR-002, decision 6): its own flag, then `release_dashboards`. Navigation and analytics both
 * read them from here, so the shell and the pages never disagree.
 */
export const ORGANIZATION_DASHBOARDS_FLAGS = [
  "release_dashboards_organization_area",
  "release_dashboards",
] as const;

/** How long a read of them stays fresh: the browser's flag cadence, five minutes. */
export const ORGANIZATION_DASHBOARDS_FLAGS_STALE_TIME_MS = 5 * 60_000;
