import type { LensConfig } from "./view.slice.ts";

/**
 * Whether a link into the Explorer may open this lens and still show the
 * result set the link describes: a lens with its own filter narrows it, and a
 * grouped lens counts groups where the link counted traces.
 */
export function lensKeepsTheResultSet(
  lens: Pick<LensConfig, "filterText" | "grouping"> | undefined,
): boolean {
  return !!lens && lens.grouping === "flat" && lens.filterText.trim() === "";
}
