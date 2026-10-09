import { Box, chakra, HStack } from "@chakra-ui/react";
import type React from "react";
import { LuChevronDown } from "react-icons/lu";

/** Menu pill: lead for empty, quiet for data. Opens via asChild; pass through props. */
const PILL_STYLES = {
  lead: {
    borderColor: "orange.emphasized",
    background: "orange.subtle",
    paddingLeft: 4,
    paddingY: "5px",
    boxShadow: "xs",
    fontSize: "13px",
    fontWeight: "medium",
    color: "orange.fg",
    _hover: { borderColor: "orange.solid", background: "orange.muted" },
  },
  quiet: {
    borderColor: "border.emphasized",
    background: "bg.muted",
    paddingLeft: 3,
    paddingY: "3px",
    boxShadow: "2xs",
    fontSize: "12px",
    fontWeight: undefined,
    color: "fg",
    _hover: { borderColor: "border.emphasized", background: "bg.emphasized" },
  },
} as const;

export interface HeroLeadPillGlyph {
  key: string;
  /** Drawn inside an 18px tile; size the glyph for a 10px box. */
  icon: React.ReactNode;
  /** The tile's text colour, for glyphs that take `currentColor`. */
  color?: string;
}

export function HeroLeadPill({
  label,
  glyphs,
  prominent = false,
  ...menuProps
}: {
  label: string;
  /** One tile per route the menu opens with, in the menu's own order. */
  glyphs: readonly HeroLeadPillGlyph[];
  /**
   * Lead with it rather than tuck it away: the filled control the eye lands
   * on, instead of a quiet outline at the end of a row.
   */
  prominent?: boolean;
} & React.ComponentProps<typeof chakra.button>) {
  const style = prominent ? PILL_STYLES.lead : PILL_STYLES.quiet;
  return (
    <chakra.button
      type="button"
      /* It opens a menu, it does not fire a prompt like the asks beside
         it do. Announce that, and show it (the caret below). */
      aria-haspopup="menu"
      {...menuProps}
      display="inline-flex"
      alignItems="center"
      gap={2}
      whiteSpace="nowrap"
      borderWidth="1px"
      borderColor={style.borderColor}
      borderRadius="full"
      background={style.background}
      paddingLeft={style.paddingLeft}
      paddingRight="4px"
      paddingY={style.paddingY}
      boxShadow={style.boxShadow}
      cursor="pointer"
      transition="border-color 130ms ease, background 130ms ease"
      _hover={style._hover}
    >
      <chakra.span fontSize={style.fontSize} fontWeight={style.fontWeight} color={style.color}>
        {label}
      </chakra.span>
      <HStack gap="3px">
        {glyphs.map(({ key, icon, color }) => (
          <Box
            key={key}
            boxSize="18px"
            borderRadius="5px"
            /* The pill's own ground went a step darker, so the tiles take
               the raised surface to stay legible against it. */
            background="bg.surface"
            borderWidth="1px"
            borderColor="border.muted"
            display="grid"
            placeItems="center"
            color={color ?? "fg.muted"}
          >
            {icon}
          </Box>
        ))}
      </HStack>
      {/* The caret is the interaction, stated. An ask fires the moment you
          click it; this one opens and asks you to choose a route, and a
          control should look like what it does before you touch it. */}
      <Box aria-hidden display="grid" color="fg.subtle" paddingRight="3px" flexShrink={0}>
        <LuChevronDown size={13} />
      </Box>
    </chakra.button>
  );
}
