// The guide's Enterprise pill, the mark in one colour beside the word; a design-system request.

import { FeatureMark } from "@langwatch/design-system/feature-mark";
import { Badge } from "@langwatch/design-system/primitives";

export function BraidsEnterprisePill() {
  return (
    <Badge size="sm" variant="subtle" colorPalette="orange" gap={1}>
      <FeatureMark feature="braids" size={12} variant="mono" />
      Enterprise
    </Badge>
  );
}
