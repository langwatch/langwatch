import { useExplorerStore } from "../stores/explorerStore";
import type { LensConfig } from "../stores/viewSlice";

/**
 * Whether a link into the Explorer may open this lens and still show the
 * result set the link describes.
 *
 * A lens with its own filter narrows what the link asked for, and a grouped
 * lens counts conversations or groups where the link counted traces. Either
 * way the number behind the link would stop matching the number that sent the
 * user there, so only a flat lens with no filter of its own is kept.
 */
export function lensKeepsTheResultSet(
  lens: Pick<LensConfig, "filterText" | "grouping"> | undefined,
): boolean {
  return !!lens && lens.grouping === "flat" && lens.filterText.trim() === "";
}

/**
 * The lens a link into the Explorer should open: the one the user is on when
 * it shows the same result set, and otherwise none, which the link builder
 * reads as the default lens.
 */
export function useExplorerLinkLensId(): string | undefined {
  return useExplorerStore((s) => {
    const lens = s.allLenses.find((l) => l.id === s.activeLensId);
    return lensKeepsTheResultSet(lens) ? s.activeLensId : undefined;
  });
}
