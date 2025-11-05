import { createContext, useContext } from "react";
import type { useZoom } from "~/hooks/useZoom";

/**
 * Context to provide zoom state and controls throughout the zoom grid component tree.
 * Single Responsibility: Share zoom state across component hierarchy.
 */
export const ZoomContext = createContext<ReturnType<typeof useZoom> | null>(
  null,
);

/**
 * Hook to access zoom context with error handling.
 * Single Responsibility: Safe access to zoom context with validation.
 *
 * @throws {Error} If used outside of ZoomContext.Provider
 */
export function useZoomContext() {
  const context = useContext(ZoomContext);
  if (!context) {
    throw new Error(
      "Zoom components must be used within SimulationZoomGrid.Root",
    );
  }
  return context;
}
