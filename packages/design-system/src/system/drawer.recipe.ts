/**
 * Drawer recipe with product-wide widths via `size` prop. Unlisted sizes fall
 * through to Chakra's own recipe. {@link dev/docs/best_practices/drawers.md}
 */

import { defineSlotRecipe } from "@chakra-ui/react";
import { drawerAnatomy } from "@chakra-ui/react/anatomy";

/**
 * The scenario editor of Agent Testing. Sits between Chakra's `md` (32rem)
 * and `lg` (42rem): `md` cut its four-question form with a criteria list
 * short, `lg` made that same form read as half a page.
 */
export const DRAWER_SIZE_2XL_MAX_WIDTH = "38.5rem";

export const drawerSlotRecipe = defineSlotRecipe({
  slots: drawerAnatomy.keys(),
  base: {
    content: {
      maxWidth: "70%",
      background:
        "color-mix(in srgb, var(--chakra-colors-bg-surface) var(--lw-panel-alpha, 80%), transparent)",
      backdropFilter: "var(--lw-backdrop-blur, blur(25px))",
      border: "1px solid",
      borderColor: "border.muted",
      borderRadius: "lg",
    },
    header: {
      paddingX: 6,
      paddingY: 4,
      paddingInlineEnd: 14,
      gap: 1,
      flexShrink: 0,
      borderBottomWidth: "1px",
      borderColor: "border.muted",
    },
    title: {
      textStyle: "md",
      fontWeight: "semibold",
      letterSpacing: "-0.01em",
      color: "fg",
    },
    description: {
      textStyle: "sm",
      color: "fg.muted",
    },
    body: {
      paddingX: 6,
      paddingY: 4,
      minHeight: 0,
      flex: 1,
      overflowY: "auto",
    },
    footer: {
      paddingX: 6,
      paddingY: 4,
      gap: 2,
      flexShrink: 0,
      justifyContent: "flex-end",
      borderTopWidth: "1px",
      borderColor: "border.muted",
    },
  },
  variants: {
    size: {
      span: { content: { maxWidth: "70%" } },
      full: { content: { maxWidth: "100%" } },
      eval: { content: { maxWidth: "1024px" } },
      "2xl": { content: { maxWidth: DRAWER_SIZE_2XL_MAX_WIDTH } },
      xl: { content: { maxWidth: "4xl" } },
    },
  },
  defaultVariants: {
    size: "xl",
  },
});
