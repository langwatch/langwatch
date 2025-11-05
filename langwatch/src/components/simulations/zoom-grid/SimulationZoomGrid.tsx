import { ZoomRoot } from "./ZoomRoot";
import { ZoomControls } from "./ZoomControls";
import { ZoomGrid } from "./ZoomGrid";

/**
 * Compound component for rendering a zoomable grid of simulations.
 * Single Responsibility: Export composed zoom grid interface.
 *
 * Usage:
 * ```tsx
 * <SimulationZoomGrid.Root>
 *   <SimulationZoomGrid.Controls />
 *   <SimulationZoomGrid.Grid scenarioRunIds={ids} />
 * </SimulationZoomGrid.Root>
 * ```
 */
export const SimulationZoomGrid = {
  Root: ZoomRoot,
  Controls: ZoomControls,
  Grid: ZoomGrid,
};
