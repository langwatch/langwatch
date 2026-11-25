/** Depth-aware z-index for nested overlays. Base (2000) exceeds Chakra modal (1400). */
import { createContext, useContext } from "react";

export const BASE_OVERLAY_Z_INDEX = 2000;
export const Z_INDEX_DEPTH_INCREMENT = 10;

export const OverlayDepthContext = createContext(0);

/**
 * Returns the z-index string and depth for the current overlay nesting level.
 * Each call in a nested overlay tree produces a higher z-index.
 */
export function useOverlayZIndex(): { zIndex: string; depth: number } {
  const parentDepth = useContext(OverlayDepthContext);
  const depth = parentDepth + 1;
  const zIndex = String(BASE_OVERLAY_Z_INDEX + depth * Z_INDEX_DEPTH_INCREMENT);
  return { zIndex, depth };
}
