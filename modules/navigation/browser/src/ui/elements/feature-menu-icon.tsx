// A branded feature's mark shaped as a menu icon: the link's size and colour, drawn in one ink.

import { FeatureMark, type FeatureName } from "@langwatch/design-system/feature-mark";
import { Box } from "@langwatch/design-system/primitives";
import type { ComponentType } from "react";

type MenuIcon = ComponentType<{ size?: string | number; color?: string }>;

const ICONS = new Map<FeatureName, MenuIcon>();

/** One stable component per feature, so a re-render never remounts the mark. */
export function featureMenuIcon(feature: FeatureName): MenuIcon {
  const known = ICONS.get(feature);
  if (known) return known;
  function FeatureMenuIcon({ size = 16, color }: { size?: string | number; color?: string }) {
    return (
      <Box as="span" display="inline-flex" color={color}>
        <FeatureMark feature={feature} size={Number(size)} variant="mono" />
      </Box>
    );
  }
  ICONS.set(feature, FeatureMenuIcon);
  return FeatureMenuIcon;
}
