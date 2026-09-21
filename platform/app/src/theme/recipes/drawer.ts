/**
 * The drawer recipe of the product: the panel material every drawer is drawn
 * with, and the widths a drawer can ask for by name.
 *
 * A drawer sets its width with `size`, never with a maxWidth of its own, so the
 * widths of the product stay a short list a reader can hold in mind. Add a step
 * here when a surface needs one; do not override the width at the call site.
 *
 * The steps this file does not name fall through to Chakra's own drawer recipe,
 * which is where `sm`, `md` and `lg` come from.
 *
 * @see dev/docs/best_practices/drawers.md
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/**
 * The scenario editor of Agent Testing.
 *
 * It sits between Chakra's `md` (32rem) and `lg` (42rem). The editor asks four
 * questions and holds a criteria list beside them, which `md` cut short, while
 * `lg` made a form of four fields read as half a page.
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
