import { useViewStore } from "./explorer.store.ts";
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

/**
 * The lens a link into the Explorer should open: the one the reader is on when
 * it shows the same result set, and otherwise none — which the link builder
 * reads as the default lens.
 */
export function useExplorerLinkLensId(): string | undefined {
  return useViewStore((s) => {
    const lens = s.allLenses.find((l) => l.id === s.activeLensId);
    return lensKeepsTheResultSet(lens) ? s.activeLensId : void 0;
  });
}
