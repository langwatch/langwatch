import { defineRecipe } from "@chakra-ui/react";

/** The rail's ground and its one full-height hairline against the content. */
export const sectionNavigationRailRecipe = defineRecipe({
  base: {
    background: "bg.subtle",
    _after: {
      content: '""',
      display: { base: "none", md: "block" },
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      width: "1px",
      background: "border.muted",
      pointerEvents: "none",
    },
  },
});
