/**
 * Drawer recipe with product-wide widths via `size` prop. Unlisted sizes fall
 * through to Chakra's own recipe. {@link dev/docs/best_practices/drawers.md}
 */

import { defineSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { drawerAnatomy } from "@chakra-ui/react/anatomy";

/**
 * The scenario editor of Agent Testing. Sits between Chakra's `md` (32rem)
 * and `lg` (42rem): `md` cut its four-question form with a criteria list
 * short, `lg` made that same form read as half a page.
 */
export const DRAWER_SIZE_2XL_MAX_WIDTH = "38.5rem";

/** The corner radius inside the drawer's 1px border, so a band sits flush against the curve. */
const INNER_RADIUS = "calc(var(--chakra-radii-lg) - 1px)";

const GLASS_FILL =
  "color-mix(in srgb, var(--chakra-colors-bg-drawer-chrome) var(--lw-panel-alpha, 50%), transparent)";

/**
 * The callable Drawer's glass header and footer: `bg.card` at half strength with 12px blur, both
 * honouring the reduced-graphics variables, over a 1px edge shown only where content waits.
 * Raw Drawer parts and the trace drawer never receive it.
 */
const glassEdgeGlint: SystemStyleObject = {
  content: '""',
  position: "absolute",
  insetInline: 0,
  height: "1px",
  pointerEvents: "none",
  opacity: 0,
  background:
    "linear-gradient(90deg, transparent 0%, var(--chakra-colors-border-drawer-glint) 30%, var(--chakra-colors-border-drawer-glint) 70%, transparent 100%)",
  transition: "opacity 160ms ease",
};

const glassBand: SystemStyleObject = {
  position: "absolute",
  insetInline: 0,
  zIndex: 1,
  borderStyle: "solid",
  borderWidth: 0,
  borderColor: "transparent",
  background: GLASS_FILL,
  backdropFilter: "var(--lw-backdrop-blur, blur(12px))",
  transition: "border-color 160ms ease",
  _motionReduce: { transition: "none" },
  "&[data-edge='on']": { borderColor: "border.drawer.edge" },
  "&::after": glassEdgeGlint,
  "&[data-edge='on']::after": { opacity: 1 },
  "@supports not (backdrop-filter: blur(1px))": { background: "bg.drawer.chrome" },
  "@media (prefers-reduced-transparency: reduce)": {
    background: "bg.drawer.chrome",
    backdropFilter: "none",
  },
  "@media (prefers-reduced-motion: reduce)": { "&::after": { transition: "none" } },
  "@media (forced-colors: active)": {
    background: "Canvas",
    backdropFilter: "none",
    borderColor: "CanvasText",
    "&::after": { display: "none" },
  },
};

export const drawerGlassHeader: SystemStyleObject = {
  ...glassBand,
  top: 0,
  borderBottomWidth: "1px",
  borderTopRadius: INNER_RADIUS,
  "&::after": { ...glassEdgeGlint, bottom: "-1px" },
};

export const raisedFooter: SystemStyleObject = {
  "&[data-edge='on']": {
    boxShadow: "0 -2px 5px color-mix(in srgb, {colors.bg.scrim} 10%, transparent)",
  },
};

export const drawerGlassFooter: SystemStyleObject = {
  ...glassBand,
  bottom: 0,
  borderTopWidth: "1px",
  borderBottomRadius: INNER_RADIUS,
  "&::after": { ...glassEdgeGlint, top: "-1px" },
};

/** The body is the one scrollport; the bands' measured heights are its clearance. */
export function drawerGlassBodyInsets({ flush }: { flush: boolean }): SystemStyleObject {
  const padding = flush ? "0px" : "var(--chakra-spacing-4)";
  return {
    paddingTop: `calc(var(--lw-drawer-top, 0px) + ${padding})`,
    paddingBottom: `calc(var(--lw-drawer-bottom, 0px) + ${padding})`,
    scrollPaddingTop: "var(--lw-drawer-top, 0px)",
    scrollPaddingBottom: "var(--lw-drawer-bottom, 0px)",
  };
}

export const drawerSlotRecipe = defineSlotRecipe({
  slots: drawerAnatomy.keys(),
  base: {
    content: {
      maxWidth: "70%",
      background: "bg.overlay",
      border: "1px solid",
      borderColor: "border.card",
      borderRadius: "lg",
    },
    header: {
      paddingX: 6,
      paddingY: 4,
      paddingInlineEnd: 14,
      gap: 1,
      flexShrink: 0,
    },
    title: {
      textStyle: "md",
      fontWeight: "medium",
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
      borderColor: "border.card",
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
