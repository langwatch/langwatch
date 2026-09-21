/**
 * Shared constants for the experiments-v3 module.
 */

/**
 * Width in pixels of the drawer when open.
 * Used to calculate table layout and scroll positioning.
 */
export const DRAWER_WIDTH = 456;

/**
 * Hover copy for the "missing variable mappings" alert icon shown on both
 * target headers (TargetHeader.tsx) and evaluator chips (EvaluatorChip.tsx).
 * Keep the two sites in lock-step — clicking the alert jumps the user to the
 * mappings editor in both cases.
 */
export const TARGET_MISSING_MAPPING_TOOLTIP =
  "Missing variable mappings - Click to configure";

/**
 * The reason an autosave carries when the seam refused it for a newer version
 * (`experiment_stale_workbench_state`). Nothing was written and nothing was
 * lost, so the toolbar names this state rather than calling it a failed save.
 * One constant, because the hook that sets the reason and the status pill that
 * reads it must agree without matching prose.
 */
export const AUTOSAVE_OUT_OF_DATE_REASON = "Out of date";
