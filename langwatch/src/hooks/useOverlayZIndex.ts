/**
 * Depth-aware z-index system for portalled overlay components.
 *
 * Each overlay (popover, select, menu, tooltip) increments the depth counter
 * so nested overlays always render above their parents. The base value (2000)
 * is higher than Chakra UI's modal z-index (1400).
 *
 * See: https://github.com/langwatch/langwatch/issues/2519
 */
import { createContext, useContext } from "react";

const BASE_OVERLAY_Z_INDEX = 2000;
const Z_INDEX_DEPTH_INCREMENT = 10;

export const OverlayDepthContext = createContext(0);

/**
 * Returns the z-index string and depth for the current overlay nesting level.
 * Each call in a nested overlay tree produces a higher z-index.
 */
export function useOverlayZIndex(): { zIndex: string; depth: number } {
  const parentDepth = useContext(OverlayDepthContext);
  const depth = parentDepth + 1;
  const zIndex = String(
    BASE_OVERLAY_Z_INDEX + depth * Z_INDEX_DEPTH_INCREMENT
  );
  return { zIndex, depth };
}
