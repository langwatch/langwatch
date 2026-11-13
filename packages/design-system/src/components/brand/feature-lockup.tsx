/** A branded feature's mark beside its name in the display face, with an optional tagline. */
import { chakra, Flex, Stack, Text } from "@chakra-ui/react";

import { FEATURE_BRANDS, type FeatureName } from "./feature-brands.ts";
import { FeatureMark } from "./feature-mark.tsx";
import { colorModeClass, type LogoColorMode } from "./logo-icon.tsx";

export type FeatureLockupSize = "sm" | "md" | "lg";

const SCALE: Record<
  FeatureLockupSize,
  { mark: number; name: string; tagline: string; gap: string }
> = {
  sm: { mark: 24, name: "20px", tagline: "xs", gap: "2" },
  md: { mark: 36, name: "30px", tagline: "sm", gap: "3" },
  lg: { mark: 58, name: "44px", tagline: "md", gap: "4" },
};

export interface FeatureLockupProps {
  feature: FeatureName;
  size?: FeatureLockupSize;
  /** Shows the feature's tagline under its name. */
  tagline?: boolean;
  /** `mono` draws the mark in the text colour, beside other one-colour marks. */
  variant?: "colour" | "mono";
  forceColorMode?: LogoColorMode;
}

export function FeatureLockup({
  feature,
  size = "md",
  tagline = false,
  variant = "colour",
  forceColorMode,
}: FeatureLockupProps) {
  const brand = FEATURE_BRANDS[feature];
  const scale = SCALE[size];
  return (
    <Flex
      align="center"
      gap={scale.gap}
      color="fg"
      className={colorModeClass(forceColorMode)}
      data-feature={feature}
    >
      <FeatureMark feature={feature} size={scale.mark} variant={variant} />
      <Stack gap="0.5" minWidth={0}>
        <chakra.span
          fontFamily="display"
          fontSize={scale.name}
          lineHeight="1"
          letterSpacing="-0.03em"
          color="fg"
        >
          {brand.name}
        </chakra.span>
        {tagline ? (
          <Text as="span" fontSize={scale.tagline} color="fg.muted" lineHeight="short">
            {brand.tagline}
          </Text>
        ) : null}
      </Stack>
    </Flex>
  );
}
