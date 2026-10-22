/** Marks where a feature is gated to Enterprise: the word, with the feature mark in one colour. */
import { Badge } from "@chakra-ui/react";

import { FeatureMark, type FeatureName } from "./feature-mark.tsx";

const MARK_SIZE = { xs: 10, sm: 12, md: 14 } as const;

export interface EnterprisePillProps {
  /** The gated feature, whose mark leads the word; without it the pill is the word alone. */
  feature?: FeatureName;
  size?: keyof typeof MARK_SIZE;
  "data-testid"?: string;
}

export function EnterprisePill({
  feature,
  size = "sm",
  "data-testid": testId,
}: EnterprisePillProps) {
  return (
    <Badge colorPalette="orange" variant="surface" size={size} gap="1" data-testid={testId}>
      {feature ? <FeatureMark feature={feature} size={MARK_SIZE[size]} variant="mono" /> : null}
      Enterprise
    </Badge>
  );
}
