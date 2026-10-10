import { defineRecipe } from "@chakra-ui/react";

export const sectionNavigationRailRecipe = defineRecipe({
  base: {
    background: "transparent",
    _after: {
      content: '""',
      display: { base: "none", md: "block" },
      position: "absolute",
      right: 0,
      top: "56px",
      bottom: "16px",
      width: "1px",
      background: "border.muted",
      pointerEvents: "none",
    },
  },
});
