/** A project's colour in a feature's brand, chosen from its id so every screen agrees on it. */
import { FEATURE_BRANDS, type FeatureName } from "./feature-brands.ts";

export interface FeatureProjectColour {
  /** 1-based, as the tokens are numbered. */
  index: number;
  /** The project's colour: `feature.<name>.project.<index>`. */
  fill: string;
  /** Text drawn on `fill`, such as the project's initials. */
  ink: string;
}

export function featureProjectColour({
  feature,
  projectId,
}: {
  feature: FeatureName;
  projectId: string;
}): FeatureProjectColour {
  const brand: { projectColours?: number } = FEATURE_BRANDS[feature];
  const count = brand.projectColours ?? 1;
  let sum = 0;
  for (const character of projectId) sum = (sum * 31 + character.charCodeAt(0)) % 9973;
  const index = (sum % count) + 1;
  return {
    index,
    fill: `feature.${feature}.project.${index}`,
    ink: `feature.${feature}.projectInk.${index}`,
  };
}
