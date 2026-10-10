import { defineRecipe } from "@chakra-ui/react";

// Structural navigation inherits the content ground; its frame owns the hairline.
export const sectionNavigationRailRecipe = defineRecipe({
  base: {
    background: "transparent",
    borderColor: "border.card",
  },
});
