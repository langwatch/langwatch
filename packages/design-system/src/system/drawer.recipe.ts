/**
 * Drawer recipe with product-wide widths via `size` prop. Unlisted sizes fall
 * through to Chakra's own recipe. {@link dev/docs/best_practices/drawers.md}
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/**
 * The scenario editor of Agent Testing. Sits between Chakra's `md` (32rem)
 * and `lg` (42rem): `md` cut its four-question form with a criteria list
 * short, `lg` made that same form read as half a page.
 */
export const DRAWER_SIZE_2XL_MAX_WIDTH = "38.5rem";

export const drawerSlotRecipe = defineSlotRecipe({
  slots: ["content", "header"],
  base: {
    content: {
      maxWidth: "70%",
      background:
        "color-mix(in srgb, var(--chakra-colors-bg-surface) var(--lw-panel-alpha, 80%), transparent)",
      backdropFilter: "var(--lw-backdrop-blur, blur(25px))",
      border: "1px solid",
      borderColor: "border",
      borderRadius: "lg",
    },
    header: {
      paddingY: 4,
      paddingRight: 12,
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
