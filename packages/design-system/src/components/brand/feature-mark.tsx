/** A branded feature's mark, drawn inline from its path data with colour only from tokens. */
import { chakra } from "@chakra-ui/react";
import { useId } from "react";

import {
  FEATURE_BRANDS,
  type FeatureName,
  type MarkMaster,
  SMALL_MASTER_MAX_SIZE,
  svgIdBase,
} from "./feature-brands.ts";
import { colorModeClass, type LogoColorMode } from "./logo-icon.tsx";

export type { FeatureName } from "./feature-brands.ts";

/** `colour` and `mono` pick their master by size; `small` forces the colour small master. */
export type FeatureMarkVariant = "colour" | "mono" | "small";

export interface FeatureMarkProps {
  feature: FeatureName;
  /** Width and height in pixels. */
  size?: number;
  variant?: FeatureMarkVariant;
  forceColorMode?: LogoColorMode;
  /** Names the mark for assistive technology; without it the mark is decorative. */
  label?: string;
}

function masterFor({
  feature,
  size,
  variant,
}: {
  feature: FeatureName;
  size: number;
  variant: FeatureMarkVariant;
}): { master: MarkMaster; small: boolean } {
  const small = variant === "small" || size <= SMALL_MASTER_MAX_SIZE;
  const { mark } = FEATURE_BRANDS[feature];
  return { master: small ? mark.small : mark.standard, small };
}

export function FeatureMark({
  feature,
  size = 32,
  variant = "colour",
  forceColorMode,
  label,
}: FeatureMarkProps) {
  const idBase = svgIdBase(useId());
  const { master, small } = masterFor({ feature, size, variant });
  const maskId = (index: number) => `${idBase}-cut-${index}`;
  const paint = (tone: string) =>
    variant === "mono" ? "currentColor" : `feature.${feature}.${tone}`;

  return (
    <chakra.svg
      xmlns="http://www.w3.org/2000/svg"
      width={`${size}px`}
      height={`${size}px`}
      viewBox="0 0 40 40"
      fill="none"
      flexShrink={0}
      className={colorModeClass(forceColorMode)}
      data-feature={feature}
      data-master={small ? "small" : "standard"}
      data-variant={variant}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
    >
      <defs>
        {master.strands.map((strand, index) =>
          strand.under === undefined ? null : (
            <mask
              key={index}
              id={maskId(index)}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="40"
              height="40"
            >
              {/* Mask luminance, not paint: white keeps, black cuts the gap. */}
              <rect width="40" height="40" fill="white" />
              <path
                d={master.strands[strand.under]?.d}
                stroke="black"
                strokeWidth={master.gapWidth}
                fill="none"
              />
            </mask>
          ),
        )}
      </defs>
      <g strokeWidth={master.strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {master.strands.map((strand, index) => (
          <chakra.path
            key={index}
            d={strand.d}
            fill="none"
            stroke={paint(strand.tone)}
            data-tone={strand.tone}
            mask={strand.under === undefined ? undefined : `url(#${maskId(index)})`}
          />
        ))}
      </g>
    </chakra.svg>
  );
}
