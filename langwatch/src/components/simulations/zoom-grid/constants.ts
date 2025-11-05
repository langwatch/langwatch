/**
 * Constants for grid layout calculations.
 * Single Responsibility: Centralize grid configuration values.
 */
export const GRID_CONSTANTS = {
  TARGET_CARD_WIDTH: 320,
  GRID_GAP_MULTIPLIER: 6, // Chakra spacing units (6 * 4px = 24px)
  MIN_COLUMNS: 1,
  FALLBACK_COLUMNS: 3,
  CARD_HEIGHT: 400,
} as const;

