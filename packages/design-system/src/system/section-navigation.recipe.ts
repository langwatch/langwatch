import { defineRecipe } from "@chakra-ui/react";

/** The rail sits on the page's own ground: no panel fill and no rule against the content. */
export const sectionNavigationRailRecipe = defineRecipe({
  base: {
    background: "transparent",
  },
});
