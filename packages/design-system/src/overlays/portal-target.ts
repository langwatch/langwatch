import { createContext, type RefObject, useContext } from "react";

/**
 * Where a popup opened inside a drawer or dialog portals: an element inside the overlay's
 * content, outside its scrolling body, so a trapped focus scope still holds the popup.
 * Popover, Menu and Select read it by default; outside any overlay it is undefined (body).
 */
const OverlayPortalTargetContext = createContext<RefObject<HTMLElement | null> | undefined>(
  undefined,
);

export const OverlayPortalTargetProvider = OverlayPortalTargetContext.Provider;

/** The nearest overlay's portal target; hand it to a third-party popup's `container`. */
export function useOverlayPortalTarget(): RefObject<HTMLElement | null> | undefined {
  return useContext(OverlayPortalTargetContext);
}
