/**
 * Shared constants for the evaluations-v3 module.
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
