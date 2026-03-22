/**
 * z-index for portalled overlay components (dropdowns, menus, tooltips, popovers).
 * Must be higher than Chakra UI's modal z-index (1400) to render above dialogs.
 * See: https://github.com/langwatch/langwatch/issues/2519
 */
export const OVERLAY_Z_INDEX = "2000";
