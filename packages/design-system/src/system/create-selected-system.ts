import { createSystem, defaultBaseConfig, mergeConfigs, type SystemConfig } from "@chakra-ui/react";
import {
  animationStyles,
  breakpoints,
  buttonRecipe,
  cssVarsPrefix,
  cssVarsRoot,
  dialogSlotRecipe,
  globalCss,
  inputRecipe,
  keyframes,
  layerStyles,
  menuSlotRecipe,
  semanticTokens,
  spinnerRecipe,
  textStyles,
  tokens,
} from "@chakra-ui/react/theme";

import {
  buttonRecipeOverride,
  designSystemFoundation,
  dialogSlotRecipeOverride,
  inputRecipeOverride,
  menuSlotRecipeOverride,
} from "./config.ts";
import type { DesignSystemExtension } from "./create-system.ts";

type Theme = NonNullable<SystemConfig["theme"]>;
type Recipe = NonNullable<Theme["recipes"]>[string];
type SlotRecipe = NonNullable<Theme["slotRecipes"]>[string];

/** A recipe a surface can select: Chakra's own, with this package's override when it has one. */
export type RecipeSelection = { chakra: Recipe; override?: Recipe };
export type SlotRecipeSelection = { chakra: SlotRecipe; override?: SlotRecipe };

export const buttonSelection: RecipeSelection = {
  chakra: buttonRecipe,
  override: buttonRecipeOverride,
};
export const inputSelection: RecipeSelection = {
  chakra: inputRecipe,
  override: inputRecipeOverride,
};
export const spinnerSelection: RecipeSelection = { chakra: spinnerRecipe };
export const dialogSelection: SlotRecipeSelection = {
  chakra: dialogSlotRecipe,
  override: dialogSlotRecipeOverride,
};
export const menuSelection: SlotRecipeSelection = {
  chakra: menuSlotRecipe,
  override: menuSlotRecipeOverride,
};

function split<T>({ selections }: { selections: Record<string, { chakra: T; override?: T }> }) {
  const entries = Object.entries(selections);
  return {
    chakra: Object.fromEntries(entries.map(([key, { chakra }]) => [key, chakra])),
    overrides: Object.fromEntries(
      entries.flatMap(([key, { override }]) => (override ? [[key, override]] : [])),
    ),
  };
}

/**
 * `createDesignSystem` with only the recipes a lazy surface renders. Every selection is a named
 * export, so the bundler drops the rest of Chakra's recipes and this package's overrides. Same
 * tokens and global styles (`designSystemFoundation`).
 */
export function createSelectedDesignSystem({
  recipes = {},
  slotRecipes = {},
  extensions = [],
}: {
  recipes?: Record<string, RecipeSelection>;
  slotRecipes?: Record<string, SlotRecipeSelection>;
  extensions?: DesignSystemExtension[];
}): ReturnType<typeof createSystem> {
  const selectedRecipes = split({ selections: recipes });
  const selectedSlotRecipes = split({ selections: slotRecipes });
  return createSystem(
    defaultBaseConfig,
    {
      preflight: true,
      cssVarsPrefix,
      cssVarsRoot,
      globalCss,
      theme: {
        breakpoints,
        keyframes,
        tokens,
        semanticTokens,
        textStyles,
        layerStyles,
        animationStyles,
        recipes: selectedRecipes.chakra,
        slotRecipes: selectedSlotRecipes.chakra,
      },
    },
    mergeConfigs(
      {
        ...designSystemFoundation,
        theme: {
          ...designSystemFoundation.theme,
          recipes: selectedRecipes.overrides,
          slotRecipes: selectedSlotRecipes.overrides,
        },
      },
      ...extensions,
    ),
  );
}
