/**
 * The quiet chip the sidebar marks an item with: grey type inside a
 * hairline border, no colour of its own. The enterprise pill and the
 * Quick Search key cap both wear it, so a mark never competes with the
 * page name it sits next to.
 *
 * Specs: specs/navigation/product-sidebars.feature,
 *        specs/navigation/settings-shell-v2.feature
 */
export const QUIET_SIDEBAR_CHIP = {
  color: "fg.faint",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "sm",
  paddingX: 1,
  paddingY: "1px",
  lineHeight: "1.3",
} as const;
